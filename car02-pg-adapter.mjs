// DPRO CAR02 R43 - R13 relational PostgreSQL adapter, offline implementation candidate ONLY.
// Never expose this module directly as public HTTP endpoints. Authentication is external.
// Never deploy R13 to an existing database without independent PostgreSQL 17 migration QA.
import { createHash } from 'node:crypto';
import { Car02Error } from './car02-core.mjs';
const E = (code, status=409) => new Car02Error(code, status);
const digest = s => createHash('sha256').update(String(s)).digest('hex');
const str = o => JSON.stringify(o);
const obj = (v, fallback=null) => typeof v === 'string' ? JSON.parse(v) : v ?? fallback;
const noRows = r => !r?.rowCount && (!r?.rows || r.rows.length === 0);
const newest = (rows=[]) => rows[0] || null;
function fixedIntentHash({actor,shop,key,intent}) {
  if (!intent || typeof intent !== 'object' || !intent.op) throw E('CAR02_IDEMPOTENCY_INTENT_REQUIRED', 422);
  // Internal request canonicalization: the core service creates keys in fixed order.
  return digest(str({shop,actorRole:actor.role,actorSubject:actor.subject,intent}));
}
function baseOrder(row) {
  return { id: row.id, shop: row.shop_code, customerId: row.customer_id, vehicleId: row.vehicle_id,
    reservationId: row.reservation_id, status: row.status, version: Number(row.state_version),
    observation: '', photos: [], items: [], revision: 0, quote: null, decision: null, events: [] };
}

export function createCar02PgAdapter(pool) {
  if (!pool || typeof pool.connect !== 'function') throw Error('CAR02_PG_POOL_REQUIRED');
  const one = async (c,q,p=[]) => newest((await c.query(q,p)).rows);
  async function hydrate(c,row) {
    if (!row) return null;
    const order=baseOrder(row);
    const report=await one(c,`SELECT id,observation,report_version FROM public.ksh_car02_reports
      WHERE work_order_id=$1 ORDER BY report_version DESC,id DESC LIMIT 1`,[order.id]);
    if (report) {
      order.observation=report.observation;
      const photos=await c.query(`SELECT id FROM public.ksh_car02_photos WHERE report_id=$1
        AND upload_state='ready' ORDER BY created_at,id`,[report.id]);
      order.photos=photos.rows.map(p=>p.id);
    }
    const quote=await one(c,`SELECT id,report_id,revision,quote_state,items_snapshot,report_snapshot,
      photos_snapshot,subtotal_yen,tax_yen,total_yen,presented_at FROM public.ksh_car02_quotes
      WHERE work_order_id=$1 ORDER BY revision DESC,id DESC LIMIT 1`,[order.id]);
    if(quote) {
      order.revision=Number(quote.revision);
      order.items=obj(quote.items_snapshot,[]);
      order.quote={id:quote.id,reportId:quote.report_id,revision:order.revision,
        items:obj(quote.items_snapshot,[]),observation:quote.report_snapshot,
        photos:obj(quote.photos_snapshot,[]),subtotal:Number(quote.subtotal_yen),
        tax:Number(quote.tax_yen),total:Number(quote.total_yen),presentedAt:quote.presented_at};
      const d=await one(c,`SELECT decision,decline_reason,decided_at FROM public.ksh_car02_decisions
        WHERE work_order_id=$1 AND quote_id=$2`,[order.id,quote.id]);
      if(d)order.decision={value:d.decision,reason:d.decline_reason,decidedAt:d.decided_at,revision:order.revision};
    }
    const events=await c.query(`SELECT event_type,actor_role,actor_fingerprint,created_at
      FROM public.ksh_car02_events WHERE work_order_id=$1 ORDER BY created_at,id`,[order.id]);
    order.events=events.rows.map(e=>({type:e.event_type,actorRole:e.actor_role,
      actorFingerprint:e.actor_fingerprint,createdAt:e.created_at}));
    return order;
  }
  async function logEvent(c,order,actor,type,details={}) {
    await c.query(`INSERT INTO public.ksh_car02_events
      (work_order_id,actor_role,actor_fingerprint,event_type,event_detail)
      VALUES ($1,$2,$3,$4,$5::jsonb)`,[order.id,actor.role,digest(actor.subject),type,str(details)]);
  }
  async function cas(c,{order,previous,status}) {
    const r=await c.query(`UPDATE public.ksh_car02_work_orders
      SET status=$4,state_version=$5,updated_at=now()
      WHERE id=$1 AND shop_code=$2 AND state_version=$3 AND status=$6
      RETURNING id`,[order.id,order.shop,previous.version,status,order.version,previous.status]);
    if(noRows(r))throw E('CAR02_VERSION_CONFLICT',409);
  }
  return {
    async lookup(shop,id) {
      const c=await pool.connect();
      try { const rec=await one(c,`SELECT * FROM public.ksh_car02_work_orders
        WHERE shop_code=$1 AND id=$2`,[shop,id]);return await hydrate(c,rec); }
      finally { c.release(); }
    },
    async history(shop,id) {
      const c=await pool.connect();
      try {return (await c.query(`SELECT e.event_type,e.actor_role,e.created_at
        FROM public.ksh_car02_events e JOIN public.ksh_car02_work_orders w ON w.id=e.work_order_id
        WHERE e.work_order_id=$1 AND w.shop_code=$2 ORDER BY e.created_at,e.id`,[id,shop])).rows;}
      finally {c.release();}
    },
    async transaction({actor,shop,key,intent},fn) {
      const c=await pool.connect();let open=false;
      const scope=`${actor.role}:${actor.subject}`;
      const requestDigest=fixedIntentHash({actor,shop,key,intent});
      try {
        await c.query('BEGIN');open=true;
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${shop}|${scope}|${key}`]);
        const existing=await one(c,`SELECT request_digest,response_snapshot,completed_at
          FROM public.ksh_car02_operations WHERE shop_code=$1 AND actor_scope=$2
          AND idempotency_key=$3 FOR UPDATE`,[shop,scope,key]);
        if(existing) {
          if(existing.request_digest!==requestDigest)throw E('CAR02_IDEMPOTENCY_KEY_REUSED',409);
          if(!existing.completed_at||!existing.response_snapshot)throw E('CAR02_IDEMPOTENCY_INCOMPLETE',409);
          await c.query('COMMIT');open=false;
          return obj(existing.response_snapshot);
        }
        const old = new Map();
        const t={
          now:()=>new Date().toISOString(),
          async assertLinks({customerId,vehicleId,reservationId}) {
            const x=await one(c,`SELECT EXISTS(SELECT 1 FROM public.ksh_demo_shop_settings WHERE shop_code=$1) AS shop_ok,
              EXISTS(SELECT 1 FROM public.ksh_demo_customers WHERE id=$2 AND shop_code=$1) AS customer_ok,
              EXISTS(SELECT 1 FROM public.ksh_demo_vehicles WHERE id=$3 AND shop_code=$1 AND customer_id=$2) AS vehicle_ok,
              ($4::uuid IS NULL OR EXISTS(SELECT 1 FROM public.ksh_demo_reservations
                WHERE id=$4 AND shop_code=$1 AND customer_id=$2 AND vehicle_id=$3)) AS reservation_ok`,
              [shop,customerId,vehicleId,reservationId]);
            if(!x?.shop_ok||!x.customer_ok||!x.vehicle_ok||!x.reservation_ok)
              throw E('CAR02_REFERENCE_SCOPE_MISMATCH',403);
          },
          async create(o) {
            const rec=await one(c,`INSERT INTO public.ksh_car02_work_orders
              (shop_code,customer_id,vehicle_id,reservation_id,status,state_version)
              VALUES ($1,$2,$3,$4,'draft',1) RETURNING *`,[shop,o.customerId,o.vehicleId,o.reservationId]);
            const output=baseOrder(rec);
            await logEvent(c,output,actor,'created');
            output.events=[{type:'created',actorRole:actor.role,actorFingerprint:digest(actor.subject)}];
            return output;
          },
          async getForUpdate(id) {
            const rec=await one(c,`SELECT * FROM public.ksh_car02_work_orders
              WHERE id=$1 AND shop_code=$2 FOR UPDATE`,[id,shop]);
            if(!rec)throw E('CAR02_NOT_FOUND',404);
            const o=await hydrate(c,rec);
            old.set(id,{version:o.version,status:o.status,revision:o.revision,
              reportObservation:o.observation,photoIds:[...o.photos],quoteId:o.quote?.id||null,
              customerId:o.customerId,vehicleId:o.vehicleId,originalEventCount:o.events.length});
            return o;
          },
          async assertReadyPhotos({order,ids}) {
            if(ids.length>3||new Set(ids).size!==ids.length)throw E('CAR02_PHOTOS_INVALID',422);
            const report=await one(c,`SELECT id FROM public.ksh_car02_reports
              WHERE work_order_id=$1 ORDER BY report_version DESC,id DESC LIMIT 1`,[order.id]);
            if(!report) {
              if(ids.length)throw E('CAR02_REPORT_FIRST_REQUIRED',409);
              return;
            }
            // No implicit photos: snapshot must match the registered READY evidence exactly.
            const rows=await c.query(`SELECT id FROM public.ksh_car02_photos
              WHERE report_id=$1 AND upload_state='ready'`,[report.id]);
            if(rows.rows.length!==ids.length ||
               rows.rows.some(x=>!ids.includes(x.id)))throw E('CAR02_PHOTO_NOT_READY_OR_SCOPE',403);
          },
          async save(o) {
            const prev=old.get(o.id);
            if(!prev||o.shop!==shop||o.customerId!==prev.customerId||o.vehicleId!==prev.vehicleId)
              throw E('CAR02_ORDER_IDENTITY_MISMATCH',403);
            if(o.version!==prev.version+1||o.events.length!==prev.originalEventCount+1)
              throw E('CAR02_VERSION_OR_EVENT_MISMATCH',409);
            const evt=o.events.at(-1)?.type;
            if(prev.status==='draft'&&o.status==='draft'&&evt==='report_saved') {
              const report=await one(c,`SELECT id,report_version FROM public.ksh_car02_reports
                WHERE work_order_id=$1 ORDER BY report_version DESC,id DESC LIMIT 1 FOR UPDATE`,[o.id]);
              if(!report) {
                await c.query(`INSERT INTO public.ksh_car02_reports (work_order_id,observation,revised_by)
                  VALUES ($1,$2,$3)`,[o.id,o.observation,actor.role]);
              } else {
                await c.query(`UPDATE public.ksh_car02_reports SET observation=$2,revised_by=$3,
                  updated_at=now() WHERE id=$1`,[report.id,o.observation,actor.role]);
              }
            } else if(prev.status==='draft'&&o.status==='pending'&&evt==='quote_presented') {
              const report=await one(c,`SELECT id FROM public.ksh_car02_reports
                WHERE work_order_id=$1 ORDER BY report_version DESC,id DESC LIMIT 1 FOR UPDATE`,[o.id]);
              if(!report||!o.quote)throw E('CAR02_REPORT_REQUIRED',409);
              const unready=await one(c,`SELECT count(*)::int AS n FROM public.ksh_car02_photos
                WHERE report_id=$1 AND upload_state='pending'`,[report.id]);
              if(Number(unready?.n||0)>0)throw E('CAR02_UPLOADS_PENDING',409);
              if(o.revision!==prev.revision+1)throw E('CAR02_REVISION_CONFLICT',409);
              const quote=await one(c,`INSERT INTO public.ksh_car02_quotes
                (work_order_id,report_id,revision,quote_state,items_snapshot,report_snapshot,
                 photos_snapshot,subtotal_yen,tax_yen,total_yen,tax_basis_points,customer_explanation)
                VALUES ($1,$2,$3,'draft',$4::jsonb,$5,$6::jsonb,$7,$8,$9,1000,'') RETURNING id`,
                [o.id,report.id,o.revision,str(o.quote.items),o.quote.observation,
                 str(o.quote.photos),o.quote.subtotal,o.quote.tax,o.quote.total]);
              // R13 guard requires quote to START draft and only then become pending.
              await c.query(`UPDATE public.ksh_car02_quotes SET quote_state='pending',
                presented_at=now() WHERE id=$1`,[quote.id]);
              await c.query(`INSERT INTO public.ksh_car02_notification_outbox
                (work_order_id,quote_id,event_type,dedupe_key)
                VALUES ($1,$2,'quote_presented',$3)`,[o.id,quote.id,`car02:quote:${quote.id}:presented`]);
            } else if(prev.status==='pending'&&['approved','declined'].includes(o.status)
                &&evt===`quote_${o.status}`) {
              const quote=await one(c,`SELECT id,quote_state FROM public.ksh_car02_quotes
                WHERE work_order_id=$1 ORDER BY revision DESC LIMIT 1 FOR UPDATE`,[o.id]);
              if(!quote||quote.quote_state!=='pending'||quote.id!==prev.quoteId)
                throw E('CAR02_QUOTE_STATE_CONFLICT',409);
              if(o.decision?.revision!==o.revision)throw E('CAR02_DECISION_REVISION_CONFLICT',409);
              // Decision INSERT must precede quote state transition for R13 trigger.
              await c.query(`INSERT INTO public.ksh_car02_decisions
                (work_order_id,quote_id,customer_id,actor_line_subject_hash,decision,decline_reason,verified_at,idempotency_key)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [o.id,quote.id,o.customerId,digest(actor.subject),o.status,
                 o.decision.reason||'',o.decision.decidedAt,key]);
              await c.query(`UPDATE public.ksh_car02_quotes SET quote_state=$2 WHERE id=$1`,
                [quote.id,o.status]);
            } else if(prev.status==='approved'&&o.status==='completed'&&evt==='completed') {
              if(!prev.quoteId||o.decision?.value!=='approved'
                  ||o.decision?.revision!==o.quote?.revision)throw E('CAR02_APPROVAL_MISMATCH',409);
            } else {
              throw E('CAR02_RELATIONAL_TRANSITION_UNSUPPORTED',409);
            }
            await cas(c,{order:o,previous:prev,status:o.status});
            await logEvent(c,o,actor,evt,{version:o.version,revision:o.revision});
            // Always return persisted state, reflecting DB timestamps / integrity.
            return hydrate(c,await one(c,`SELECT * FROM public.ksh_car02_work_orders
              WHERE id=$1 AND shop_code=$2`,[o.id,shop]));
          }
        };
        const response=await fn(t);
        await c.query(`INSERT INTO public.ksh_car02_operations
          (shop_code,actor_scope,idempotency_key,request_digest,response_snapshot,completed_at)
          VALUES ($1,$2,$3,$4,$5::jsonb,now())`,[shop,scope,key,requestDigest,str(response)]);
        await c.query('COMMIT');open=false;return response;
      } catch(err) {if(open)await c.query('ROLLBACK');throw err;}
      finally {c.release();}
    }
  };
}
