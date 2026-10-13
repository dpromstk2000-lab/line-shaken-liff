"""CAR02 R118 disposable SQLite safety *model* — NOT a production adapter.

No network, Supabase, LINE, Worker, or customer data. Synthetic tenants only.
SQLite's transaction model is NOT proof of PostgreSQL/Supabase behavior.
"""
from __future__ import annotations

import re
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, time
from pathlib import Path
from zoneinfo import ZoneInfo

JST = ZoneInfo('Asia/Tokyo')
DATE_FORMAT = '%Y-%m-%dT%H:%M'
TENANT_PATTERN = re.compile(r'^qa_[a-z0-9_]{2,30}$')
REQUEST_PATTERN = re.compile(r'^qa-[A-Za-z0-9_-]{8,90}$')


class Denied(Exception):
    """Fail-closed outcome; never carries credentials or customer values."""


@dataclass(frozen=True)
class Actor:
    tenant: str
    staff_id: str
    role: str  # synthetic fixture role, never an authentication assertion


@dataclass(frozen=True)
class BookingSwitches:
    booking_web: bool = True
    hp: bool = True
    line: bool = False


def _valid_tenant(value: str) -> None:
    if not isinstance(value, str) or not TENANT_PATTERN.fullmatch(value):
        raise Denied('INVALID_TENANT')


def _require_actor(actor: Actor, tenant: str, roles: set[str]) -> None:
    _valid_tenant(tenant)
    if not isinstance(actor, Actor) or actor.tenant != tenant or actor.role not in roles:
        raise Denied('TENANT_OR_ROLE_DENIED')


def connect(dbfile: Path | str) -> sqlite3.Connection:
    conn = sqlite3.connect(str(dbfile), timeout=20.0, isolation_level=None)
    conn.execute('PRAGMA busy_timeout=20000')
    conn.execute('PRAGMA foreign_keys=ON')
    conn.execute('PRAGMA journal_mode=WAL')
    return conn


def create_fixture_schema(conn: sqlite3.Connection) -> None:
    conn.executescript('''
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY, tenant TEXT NOT NULL, resource TEXT NOT NULL,
      starts_local TEXT NOT NULL, request_key TEXT NOT NULL, source TEXT NOT NULL,
      UNIQUE(tenant, resource, starts_local), UNIQUE(tenant, request_key)
    );
    CREATE TABLE IF NOT EXISTS photo_quarantine (
      id TEXT PRIMARY KEY, tenant TEXT NOT NULL, photo_ref TEXT NOT NULL,
      object_key TEXT NOT NULL, request_key TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'QUARANTINED' CHECK(state = 'QUARANTINED'),
      UNIQUE(tenant, object_key), UNIQUE(tenant, request_key), UNIQUE(tenant, id)
    );
    CREATE TRIGGER IF NOT EXISTS photo_no_update BEFORE UPDATE ON photo_quarantine
      BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_QUARANTINE'); END;
    CREATE TRIGGER IF NOT EXISTS photo_no_delete BEFORE DELETE ON photo_quarantine
      BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_QUARANTINE'); END;
    CREATE TABLE IF NOT EXISTS review_events (
      id TEXT PRIMARY KEY, tenant TEXT NOT NULL, quarantine_id TEXT NOT NULL,
      reviewer_id TEXT NOT NULL, event TEXT NOT NULL
        CHECK(event IN ('EVIDENCE_SEEN', 'ESCALATE_ONLY')),
      FOREIGN KEY(tenant, quarantine_id) REFERENCES photo_quarantine(tenant, id)
    );
    CREATE TRIGGER IF NOT EXISTS review_no_update BEFORE UPDATE ON review_events
      BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_REVIEW'); END;
    CREATE TRIGGER IF NOT EXISTS review_no_delete BEFORE DELETE ON review_events
      BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_REVIEW'); END;
    CREATE TABLE IF NOT EXISTS staff_roles (
      tenant TEXT NOT NULL, staff_id TEXT NOT NULL, role TEXT NOT NULL
        CHECK(role IN ('owner', 'staff')), active INTEGER NOT NULL CHECK(active IN (0,1)),
      PRIMARY KEY(tenant, staff_id)
    );
    ''')


def _booking_time(starts: str, now: datetime) -> datetime:
    if not isinstance(starts, str) or not re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d', starts):
        raise Denied('BAD_START_FORMAT')
    try:
        naive = datetime.strptime(starts, DATE_FORMAT)
    except ValueError:
        raise Denied('INVALID_START') from None
    start = naive.replace(tzinfo=JST)
    if now.tzinfo is None:
        raise Denied('CLOCK_MUST_BE_AWARE')
    current = now.astimezone(JST)
    if start <= current:
        raise Denied('PAST_OR_NOW')
    if (start.date() - current.date()).days > 60:
        raise Denied('OUTSIDE_BOOKING_WINDOW')
    if start.weekday() == 6:
        raise Denied('CLOSED_SUNDAY')
    if start.minute not in (0,30) or start.second != 0 or not(time(9) <= start.time() <= time(17,30)):
        raise Denied('INVALID_HALF_HOUR_SLOT')
    return start


def reserve_booking(conn: sqlite3.Connection, actor: Actor, tenant: str, resource: str,
                    starts: str, request_key: str, source: str,
                    switches: BookingSwitches, now: datetime) -> tuple[str,bool]:
    """Return (synthetic_id, newly_created); duplicate same request is idempotent.
    Atomic reservation in disposable SQLite only. Backend transaction proof required later.
    """
    _require_actor(actor, tenant, {'customer', 'staff', 'owner'})
    if not isinstance(resource,str) or not re.fullmatch(r'qa_bay_[1-9][0-9]?',resource):
        raise Denied('BAD_RESOURCE')
    if not isinstance(request_key,str) or not REQUEST_PATTERN.fullmatch(request_key):
        raise Denied('BAD_IDEMPOTENCY_KEY')
    if source not in ('web','hp','line'):
        raise Denied('BAD_SOURCE')
    if not isinstance(switches,BookingSwitches) or not switches.booking_web:
        raise Denied('BOOKING_DISABLED')
    if source == 'hp' and not switches.hp:
        raise Denied('HP_DISABLED')
    if source == 'line' and not switches.line:
        raise Denied('LINE_DISABLED')
    _booking_time(starts,now)
    try:
        conn.execute('BEGIN IMMEDIATE')
        old = conn.execute('SELECT id,resource,starts_local,source FROM bookings WHERE tenant=? AND request_key=?',
                           (tenant,request_key)).fetchone()
        if old is not None:
            if old[1:] != (resource,starts,source):
                raise Denied('IDEMPOTENCY_PAYLOAD_MISMATCH')
            conn.commit()
            return old[0],False
        synthetic_id = 'qa_' + uuid.uuid4().hex
        conn.execute('INSERT INTO bookings (id,tenant,resource,starts_local,request_key,source) VALUES (?,?,?,?,?,?)',
                     (synthetic_id,tenant,resource,starts,request_key,source))
        conn.commit()
        return synthetic_id,True
    except sqlite3.IntegrityError:
        conn.rollback()
        raise Denied('SLOT_ALREADY_RESERVED') from None
    except BaseException:
        conn.rollback()
        raise


def quarantine_photo(conn: sqlite3.Connection, actor: Actor, tenant: str,
                     photo_ref: str, object_key: str, request_key: str) -> tuple[str,bool]:
    """Persist uncertain-photo quarantine ONLY. Deliberately no delete/Storage client."""
    _require_actor(actor,tenant,{'staff','owner'})
    if not isinstance(photo_ref,str) or not re.fullmatch(r'qa_photo_[a-z0-9]{6,40}',photo_ref):
        raise Denied('INVALID_SYNTHETIC_PHOTO')
    if not isinstance(object_key,str) or not re.fullmatch(r'qa_objects/[a-z0-9_-]{8,110}',object_key):
        raise Denied('INVALID_SYNTHETIC_OBJECT_PATH')
    if not isinstance(request_key,str) or not REQUEST_PATTERN.fullmatch(request_key):
        raise Denied('BAD_IDEMPOTENCY_KEY')
    try:
        conn.execute('BEGIN IMMEDIATE')
        old=conn.execute('SELECT id,photo_ref,object_key FROM photo_quarantine WHERE tenant=? AND request_key=?',
                         (tenant,request_key)).fetchone()
        if old is not None:
            if old[1:]!=(photo_ref,object_key):
                raise Denied('QUARANTINE_REQUEST_MISMATCH')
            conn.commit()
            return old[0],False
        qid='qa_q_'+uuid.uuid4().hex
        conn.execute('INSERT INTO photo_quarantine (id,tenant,photo_ref,object_key,request_key) VALUES (?,?,?,?,?)',
                     (qid,tenant,photo_ref,object_key,request_key))
        conn.commit()
        return qid,True
    except sqlite3.IntegrityError:
        conn.rollback()
        raise Denied('OBJECT_KEY_ALREADY_RESERVED') from None
    except BaseException:
        conn.rollback()
        raise


def read_quarantine(conn: sqlite3.Connection, actor: Actor, tenant: str) -> list[tuple[str,str]]:
    _require_actor(actor,tenant,{'owner','reviewer'})
    return conn.execute('SELECT id,state FROM photo_quarantine WHERE tenant=? ORDER BY id',(tenant,)).fetchall()


def review_quarantine(conn: sqlite3.Connection, actor: Actor, tenant: str, qid: str, event: str) -> str:
    _require_actor(actor,tenant,{'owner','reviewer'})
    if event not in ('EVIDENCE_SEEN','ESCALATE_ONLY'):
        raise Denied('DELETION_APPROVAL_UNSUPPORTED')
    try:
        conn.execute('BEGIN IMMEDIATE')
        found=conn.execute('SELECT 1 FROM photo_quarantine WHERE tenant=? AND id=?',(tenant,qid)).fetchone()
        if not found:
            raise Denied('QUARANTINE_NOT_FOUND_IN_TENANT')
        evid='qa_ev_'+uuid.uuid4().hex
        conn.execute('INSERT INTO review_events (id,tenant,quarantine_id,reviewer_id,event) VALUES (?,?,?,?,?)',
                     (evid,tenant,qid,actor.staff_id,event))
        conn.commit()
        return evid
    except BaseException:
        conn.rollback()
        raise


def set_staff(conn: sqlite3.Connection, actor: Actor, tenant: str,
              target_id: str, next_role: str, next_active: bool) -> None:
    """Synthetic owner invariant, NOT actual identity, staff API or RLS."""
    _require_actor(actor,tenant,{'owner'})
    if actor.staff_id == target_id:
        raise Denied('SELF_ROLE_CHANGE_DENIED')
    if next_role not in ('owner','staff') or not isinstance(next_active,bool):
        raise Denied('INVALID_ROLE_CHANGE')
    try:
        conn.execute('BEGIN IMMEDIATE')
        caller=conn.execute('SELECT role,active FROM staff_roles WHERE tenant=? AND staff_id=?',
                            (tenant,actor.staff_id)).fetchone()
        if caller != ('owner',1):
            raise Denied('OWNER_AUTHORIZATION_RECHECK_FAILED')
        current=conn.execute('SELECT role,active FROM staff_roles WHERE tenant=? AND staff_id=?',
                             (tenant,target_id)).fetchone()
        if current is None:
            raise Denied('TARGET_NOT_FOUND')
        if current==('owner',1) and (next_role!='owner' or not next_active):
            count=conn.execute('SELECT count(*) FROM staff_roles WHERE tenant=? AND role=? AND active=1',
                               (tenant,'owner')).fetchone()[0]
            if count <= 1:
                raise Denied('LAST_OWNER_PROTECTED')
        conn.execute('UPDATE staff_roles SET role=?, active=? WHERE tenant=? AND staff_id=?',
                     (next_role,int(next_active),tenant,target_id))
        conn.commit()
    except BaseException:
        conn.rollback()
        raise


def assert_restored_integrity(dbfile: Path | str) -> dict[str,int]:
    """Only a disposable SQLite integrity check; never asserts production recoverability."""
    conn=sqlite3.connect(str(dbfile))
    try:
        result=conn.execute('PRAGMA integrity_check').fetchone()
        if result is None or result[0]!='ok':
            raise Denied('SYNTHETIC_RESTORE_INTEGRITY_FAILED')
        tables={t:conn.execute(f'SELECT count(*) FROM {t}').fetchone()[0]
                for t in ('bookings','photo_quarantine','review_events','staff_roles')}
        return tables
    except sqlite3.DatabaseError:
        raise Denied('SYNTHETIC_RESTORE_CORRUPT') from None
    finally:
        conn.close()
