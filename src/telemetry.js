// OpenTelemetry: traces and metrics, sent over OTLP to Grafana Cloud (or any
// OTLP backend). It's OFF unless OTEL_EXPORTER_OTLP_ENDPOINT is set, so local
// runs and tests behave exactly as before.
//
// Load it before anything else that should be traced (server.js line 2):
//   require('dotenv').config();
//   require('./telemetry');
//
// Env (set in Render):
//   OTEL_EXPORTER_OTLP_ENDPOINT  e.g. https://otlp-gateway-prod-eu-west-2.grafana.net/otlp
//   OTEL_EXPORTER_OTLP_HEADERS   Authorization=Basic <base64 of instanceId:token>
//   OTEL_SERVICE_NAME            univerify (default)
//   OTEL_RESOURCE_ATTRIBUTES     deployment.environment.name=production (optional)
//
// Privacy: no names, emails, matric numbers, document IDs, query strings or
// client IPs leave the app. See scrub() below; tests/telemetry.js checks it.

const { metrics, trace, context } = require('@opentelemetry/api');

const ENABLED = !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

// ── Privacy filter ─────────────────────────────────────────────────────────
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Document IDs (DSU-20261117-09BQ1DYJAZ2KW4WV), matric numbers (CSC/2021/001)
// and any other run of 6+ digits or long random tokens
const DOC_ID = /\b[A-Z]{2,8}-\d{8}-[A-Z0-9]{6,}\b/gi;
const MATRIC = /\b[A-Z]{2,5}\/\d{2,4}\/\d{1,5}\b/gi;
const LONG_NUM = /\d{6,}/g;
const TOKEN = /\b[A-Za-z0-9_-]{24,}\b/g;

function scrubText(s) {
  if (typeof s !== 'string') return s;
  return s.replace(EMAIL, '[email]').replace(DOC_ID, '[doc]').replace(MATRIC, '[matric]')
    .replace(TOKEN, '[token]').replace(LONG_NUM, '[num]').slice(0, 500);
}

// URLs keep their path shape but lose the query string and any ID-like segment
function scrubUrl(u) {
  if (typeof u !== 'string') return u;
  const [base, query] = u.split('?');
  const path = base.split('/').map(seg => {
    let s; try { s = decodeURIComponent(seg); } catch (_) { s = seg; }
    if (DOC_ID.test(s) || /\d{4,}/.test(s) || s.length >= 24 || EMAIL.test(s)) { DOC_ID.lastIndex = 0; EMAIL.lastIndex = 0; return ':id'; }
    return seg;
  }).join('/');
  return query === undefined ? path : path + '?[redacted]';
}

const URL_KEYS = ['url.full', 'url.path', 'http.url', 'http.target', 'url.query'];
const DROP_KEYS = ['client.address', 'network.peer.address', 'net.peer.ip', 'http.client_ip', 'net.sock.peer.addr', 'user.email', 'enduser.id'];

function scrubAttributes(attrs, set) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (DROP_KEYS.includes(k)) set(k, 'redacted');
    else if (k === 'url.query') set(k, '[redacted]');
    else if (URL_KEYS.includes(k)) set(k, scrubUrl(v));
    else if (typeof v === 'string' && k !== 'db.statement' && k !== 'db.query.text') { const c = scrubText(v); if (c !== v) set(k, c); }
  }
}

// Runs just before a span ends, while it can still be changed
const scrubProcessor = {
  onStart() {},
  onEnding(span) {
    scrubAttributes(span.attributes, (k, v) => span.setAttribute(k, v));
    if (span.name) span.updateName(scrubUrl(span.name));
    for (const ev of span.events || []) {
      if (ev.attributes) scrubAttributes(ev.attributes, (k, v) => { ev.attributes[k] = v; });
    }
  },
  onEnd() {},
  shutdown() { return Promise.resolve(); },
  forceFlush() { return Promise.resolve(); },
};

// ── SDK start ──────────────────────────────────────────────────────────────
let sdk = null;
if (ENABLED) {
  const { NodeSDK } = require('@opentelemetry/sdk-node');
  const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace');
  const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
  const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-proto');
  const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-proto');
  const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
  const { ExpressInstrumentation } = require('@opentelemetry/instrumentation-express');
  const { PgInstrumentation } = require('@opentelemetry/instrumentation-pg');

  // Logs stay in Render for now; don't start an OTLP log pipeline we don't feed
  process.env.OTEL_LOGS_EXPORTER = process.env.OTEL_LOGS_EXPORTER || 'none';
  const STATIC = /\.(css|js|png|jpe?g|svg|ico|woff2?|map|webp)$/i;
  sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME || 'univerify',
    // scrubProcessor must come first: it cleans each span before the batch exporter sees it
    spanProcessors: [scrubProcessor, new BatchSpanProcessor({
      exporter: new OTLPTraceExporter(),
      scheduledDelayMillis: Number(process.env.OTEL_BSP_SCHEDULE_DELAY) || 5000,
    })],
    metricReaders: [new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
      exportIntervalMillis: Number(process.env.OTEL_METRIC_EXPORT_INTERVAL) || 60000,
    })],
    instrumentations: [
      new HttpInstrumentation({
        // Health checks and static files are noise
        ignoreIncomingRequestHook: req => req.url === '/health' || STATIC.test((req.url || '').split('?')[0]),
      }),
      new ExpressInstrumentation({ ignoreLayersType: ['middleware'] }),
      // SQL text only (with $1 placeholders), never the values
      new PgInstrumentation({ enhancedDatabaseReporting: false, requireParentSpan: true, ignoreConnectSpans: true }),
    ],
  });
  sdk.start();
  console.log('Telemetry: OpenTelemetry on, sending to', new URL(process.env.OTEL_EXPORTER_OTLP_ENDPOINT).host);

  const stop = () => sdk.shutdown().catch(() => {}).finally(() => process.exit(0));
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

// ── Business metrics ───────────────────────────────────────────────────────
// Safe to call when telemetry is off: the API hands back no-op instruments.
const meter = metrics.getMeter('univerify');
const counters = {
  verifications: meter.createCounter('univerify.verifications', { description: 'QR and ID verifications, by school and result' }),
  payments: meter.createCounter('univerify.payments', { description: 'Paystack payments settled, by kind and outcome' }),
  webhooks: meter.createCounter('univerify.webhooks', { description: 'Paystack webhooks received, by outcome' }),
  activity: meter.createCounter('univerify.staff_actions', { description: 'Staff actions from the activity log, by school and action' }),
};

const clean = attrs => Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v).slice(0, 60)]));
function count(name, attrs = {}) {
  try { counters[name].add(1, clean(attrs)); } catch (_) { /* never break a request */ }
}

// Label the current request's trace with the school subdomain
function tagTenant(subdomain) {
  if (!ENABLED || !subdomain) return;
  try {
    const { getRPCMetadata } = require('@opentelemetry/core');
    const rpc = getRPCMetadata(context.active());
    const span = (rpc && rpc.span) || trace.getActiveSpan();
    if (span) span.setAttribute('univerify.tenant', subdomain);
  } catch (_) { /* ignore */ }
}

module.exports = { ENABLED, count, tagTenant, scrubText, scrubUrl, scrubProcessor };
