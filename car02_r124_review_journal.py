"""DPRO CAR02 R124: synthetic, fail-closed, offline review journal.

NOT an authorization service.  Does not connect to or mutate real R47/Storage,
Supabase, PostgreSQL, users, or photos. Evidence is accepted only after the
R123 independent offline review model has constructed a complete decision record.
"""
import hashlib
import json
import re
import sqlite3
import tempfile
from pathlib import Path

QA_RELEASE = 'NO_GO'
QA_MIGRATION = 'HOLD'
DB_NAME = 'car02_r124_offline_qa_ci'
SHA = re.compile(r'^[0-9a-f]{64}$')
SHOP = re.compile(r'^[a-z0-9][a-z0-9_-]{1,63}$')
UUID = re.compile(r'^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
REVIEW_FIELDS = {'reviewId', 'subject', 'role', 'reviewedAtMs', 'decision'}
RECORD_FIELDS = {
 'version','shop','orderId','reportId','intentKey','quarantineRevision',
 'quarantineState','snapshotHash','evidenceHash','evidenceId','reviewers',
 'decision','mutationAllowed','deleteAllowed','markReadyAllowed',
 'realStorageTested','realAuthTested','release','migration','recordHash'
}

class R124Denied(ValueError):
    pass

def require(condition, code):
    if not condition:
        raise R124Denied('R124_' + code)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def json_js(value):
    # The supported R123 record is all ASCII and integer-valued; JS JSON.stringify
    # and this compact form are identical. No arbitrary JSON types are admitted.
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')

def checked_record(record):
    require(type(record) is dict and set(record) == RECORD_FIELDS, 'RECORD_SHAPE')
    require(record['version'] == 'R123' and record['release'] == QA_RELEASE
            and record['migration'] == QA_MIGRATION, 'RELEASE_CLOSED')
    require(record['decision'] == 'MANUAL_STAGING_VALIDATION_PENDING'
            and record['quarantineState'] == 'QUARANTINED', 'NO_PHOTO_PROMOTION')
    require(all(record[k] is False for k in (
        'mutationAllowed','deleteAllowed','markReadyAllowed',
        'realStorageTested','realAuthTested')), 'READONLY_REQUIRED')
    require(type(record['shop']) is str and bool(SHOP.fullmatch(record['shop'])), 'SHOP')
    require(all(type(record[k]) is str and UUID.fullmatch(record[k])
            for k in ('orderId','reportId','intentKey','evidenceId')), 'UUID')
    require(type(record['quarantineRevision']) is int
            and 0 < record['quarantineRevision'] <= 2147483647, 'REVISION')
    require(all(type(record[k]) is str and SHA.fullmatch(record[k])
            for k in ('snapshotHash','evidenceHash','recordHash')), 'DIGEST')
    reviewers = record['reviewers']
    require(type(reviewers) is list and len(reviewers) == 2, 'REVIEW_COUNT')
    subjects, review_ids, owner_count = set(), set(), 0
    for review in reviewers:
        require(type(review) is dict and set(review) == REVIEW_FIELDS, 'REVIEW_SHAPE')
        require(type(review['reviewId']) is str and bool(UUID.fullmatch(review['reviewId'])), 'REVIEW_ID')
        require(type(review['subject']) is str and review['subject'].startswith('staff:')
                and bool(UUID.fullmatch(review['subject'][6:])), 'REVIEW_SUBJECT')
        require(review['role'] in ('staff','owner') and type(review['reviewedAtMs']) is int
                and 0 <= review['reviewedAtMs'] < 10**16, 'REVIEW_ACTOR')
        require(review['decision'] == 'request_manual_staging_validation', 'REVIEW_DECISION')
        subjects.add(review['subject']); review_ids.add(review['reviewId'])
        owner_count += review['role'] == 'owner'
    require(len(subjects) == len(review_ids) == 2 and owner_count >= 1, 'REVIEW_INDEPENDENCE')
    # Use existing R123 record ordering, where recordHash is appended at the end.
    require(sha(json_js({k: v for k, v in record.items() if k != 'recordHash'}))
            == record['recordHash'], 'HASH_MISMATCH')
    return record

SCHEMA = '''
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS r124_journal (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 shop TEXT NOT NULL,
 intent_key TEXT NOT NULL,
 revision INTEGER NOT NULL,
 evidence_id TEXT NOT NULL,
 record_hash TEXT NOT NULL,
 record_blob TEXT NOT NULL,
 received_at_ms INTEGER NOT NULL,
 prev_hash TEXT NOT NULL,
 event_hash TEXT NOT NULL UNIQUE,
 UNIQUE(shop,intent_key,revision),
 UNIQUE(shop,evidence_id)
);
CREATE TABLE IF NOT EXISTS r124_review_ids (
 shop TEXT NOT NULL,
 review_id TEXT NOT NULL,
 journal_seq INTEGER NOT NULL REFERENCES r124_journal(seq),
 PRIMARY KEY(shop,review_id)
);
CREATE TRIGGER IF NOT EXISTS r124_review_no_update BEFORE UPDATE ON r124_review_ids
BEGIN SELECT RAISE(ABORT, 'R124_IMMUTABLE_REVIEW_UPDATE'); END;
CREATE TRIGGER IF NOT EXISTS r124_review_no_delete BEFORE DELETE ON r124_review_ids
BEGIN SELECT RAISE(ABORT, 'R124_IMMUTABLE_REVIEW_DELETE'); END;
CREATE TRIGGER IF NOT EXISTS r124_no_update BEFORE UPDATE ON r124_journal
BEGIN SELECT RAISE(ABORT, 'R124_IMMUTABLE_UPDATE'); END;
CREATE TRIGGER IF NOT EXISTS r124_no_delete BEFORE DELETE ON r124_journal
BEGIN SELECT RAISE(ABORT, 'R124_IMMUTABLE_DELETE'); END;
'''

class R124ReviewJournal:
    def __init__(self, db_path, *, environment, release_lock):
        require(environment == 'isolated_qa' and release_lock is True, 'ISOLATION')
        self.path = Path(db_path).resolve()
        require(self.path.name == DB_NAME + '.sqlite3', 'DB_NAME')
        root = Path(tempfile.gettempdir()).resolve()
        require(root in self.path.parents and any(
            segment.name.startswith('car02-r124') for segment in self.path.parents if segment != root
        ), 'TEMP_ONLY')
        require(self.path.parent.is_dir(), 'DB_PARENT')
        self.db = sqlite3.connect(str(self.path), timeout=10, isolation_level=None)
        self.db.execute('PRAGMA busy_timeout=10000')
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.executescript(SCHEMA)

    def close(self):
        self.db.close()

    def accept(self, record, *, scoped_shop, received_at_ms, fail_before_insert=False):
        record = checked_record(record)
        require(scoped_shop == record['shop'] and type(scoped_shop) is str, 'TENANT_SCOPE')
        require(type(received_at_ms) is int and 0 <= received_at_ms < 10**16, 'CLOCK')
        cur = self.db.cursor()
        cur.execute('BEGIN IMMEDIATE')
        try:
            prior = cur.execute('''SELECT record_hash,seq,event_hash FROM r124_journal
                WHERE shop=? AND intent_key=? AND revision=?''', (
                scoped_shop, record['intentKey'], record['quarantineRevision'])).fetchone()
            if prior:
                require(prior[0] == record['recordHash'], 'REPLAY_CONFLICT')
                self.db.commit()
                return {'status':'EXISTING', 'seq':prior[1], 'eventHash':prior[2]}
            evid = cur.execute('SELECT 1 FROM r124_journal WHERE shop=? AND evidence_id=?',
                               (scoped_shop, record['evidenceId'])).fetchone()
            require(evid is None, 'EVIDENCE_REBIND')
            prev = cur.execute('SELECT event_hash FROM r124_journal ORDER BY seq DESC LIMIT 1').fetchone()
            prev_hash = prev[0] if prev else '0'*64
            event_hash = sha(json_js({'prev':prev_hash,'recordHash':record['recordHash'],
                'shop':scoped_shop,'intentKey':record['intentKey'],
                'revision':record['quarantineRevision'], 'receivedAtMs':received_at_ms}))
            if fail_before_insert:
                raise RuntimeError('R124_INJECTED_BEFORE_INSERT')
            cur.execute('''INSERT INTO r124_journal
                (shop,intent_key,revision,evidence_id,record_hash,record_blob,
                 received_at_ms,prev_hash,event_hash)
                VALUES(?,?,?,?,?,?,?,?,?)''', (
                scoped_shop, record['intentKey'],record['quarantineRevision'],
                record['evidenceId'],record['recordHash'],
                json_js(record).decode('utf-8'),received_at_ms,prev_hash,event_hash))
            seq = cur.lastrowid
            for review in record['reviewers']:
                cur.execute('INSERT INTO r124_review_ids(shop,review_id,journal_seq) VALUES (?,?,?)',
                    (scoped_shop,review['reviewId'],seq))
            self.db.commit()
            return {'status':'NEW','seq':seq,'eventHash':event_hash}
        except Exception:
            self.db.rollback()
            raise

    def inspect(self, scoped_shop):
        require(type(scoped_shop) is str and bool(SHOP.fullmatch(scoped_shop)), 'TENANT_SCOPE')
        return [json.loads(r[0]) for r in self.db.execute(
            'SELECT record_blob FROM r124_journal WHERE shop=? ORDER BY seq',(scoped_shop,))]

    def verify_chain(self):
        prev = '0'*64
        rows = self.db.execute('''SELECT shop,intent_key,revision,record_hash,record_blob,
                    received_at_ms,prev_hash,event_hash FROM r124_journal ORDER BY seq''').fetchall()
        for idx, (shop,intent,rev,record_hash,raw,received,prior,h) in enumerate(rows):
            record=json.loads(raw)
            checked_record(record)
            require(record['shop']==shop and record['intentKey']==intent
                    and record['quarantineRevision']==rev and record['recordHash']==record_hash,
                    'ROW_TAMPERED')
            require(prior==prev and sha(json_js({'prev':prev,'recordHash':record_hash,
                'shop':shop,'intentKey':intent,'revision':rev,
                'receivedAtMs':received})) == h, 'CHAIN_TAMPERED')
            review_rows = self.db.execute('''SELECT review_id FROM r124_review_ids
                WHERE journal_seq=(SELECT seq FROM r124_journal WHERE event_hash=?)''',(h,)).fetchall()
            require(sorted(x[0] for x in review_rows) == sorted(r['reviewId'] for r in record['reviewers']),
                    'REVIEW_LINK_TAMPERED')
            prev=h
        require(self.db.execute('SELECT count(*) FROM r124_review_ids').fetchone()[0] == 2*len(rows),
                'ORPHAN_REVIEW_ID')
        return {'rows':len(rows),'head':prev,'release':QA_RELEASE,'migration':QA_MIGRATION}

    def backup(self, destination):
        # Backup is only an offline test database snapshot. Never a photo restore.
        target=sqlite3.connect(str(destination));
        try:
            self.db.backup(target)
        finally:
            target.close()
        return str(destination)
