//! Prometheus metrics for the Stellar API.
//!
//! Exposes request counts, latencies, and business metrics at `GET /metrics`.
//! Uses `actix-web-prom` middleware for automatic HTTP metrics and custom
//! `prometheus` counters/histograms for business-level observability.

use actix_web_prom::PrometheusMetricsBuilder;
use prometheus::{opts, Histogram, HistogramOpts, IntCounter, IntCounterVec, Opts, Registry};

/// Build a counter, logging and skipping it (rather than panicking) if creation fails
/// — e.g. because a future change introduces a duplicate metric name.
fn make_counter(registry: &Registry, name: &str, opts: Opts) -> Option<IntCounter> {
    match IntCounter::with_opts(opts) {
        Ok(metric) => {
            if let Err(e) = registry.register(Box::new(metric.clone())) {
                tracing::warn!("Failed to register metric {}: {}", name, e);
            }
            Some(metric)
        }
        Err(e) => {
            tracing::warn!("Failed to create metric {}: {}", name, e);
            None
        }
    }
}

/// Build a counter vec, logging and skipping it (rather than panicking) if creation fails.
fn make_counter_vec(
    registry: &Registry,
    name: &str,
    opts: Opts,
    labels: &[&str],
) -> Option<IntCounterVec> {
    match IntCounterVec::new(opts, labels) {
        Ok(metric) => {
            if let Err(e) = registry.register(Box::new(metric.clone())) {
                tracing::warn!("Failed to register metric {}: {}", name, e);
            }
            Some(metric)
        }
        Err(e) => {
            tracing::warn!("Failed to create metric {}: {}", name, e);
            None
        }
    }
}

/// Build a histogram, logging and skipping it (rather than panicking) if creation fails.
fn make_histogram(registry: &Registry, name: &str, opts: HistogramOpts) -> Option<Histogram> {
    match Histogram::with_opts(opts) {
        Ok(metric) => {
            if let Err(e) = registry.register(Box::new(metric.clone())) {
                tracing::warn!("Failed to register metric {}: {}", name, e);
            }
            Some(metric)
        }
        Err(e) => {
            tracing::warn!("Failed to create metric {}: {}", name, e);
            None
        }
    }
}

/// Custom business metrics registered alongside the HTTP middleware metrics.
/// Individual metrics are `None` when creation/registration failed (e.g. a
/// duplicate name) so one bad metric can't take down the rest of the API.
#[derive(Clone)]
pub struct BusinessMetrics {
    pub bounties_created: Option<IntCounter>,
    pub applications_submitted: Option<IntCounter>,
    pub freelancers_registered: Option<IntCounter>,
    pub escrows_released: Option<IntCounter>,
    pub escrows_deposits: Option<IntCounterVec>,
    pub dispute_resolution_seconds: Option<Histogram>,
    pub stellar_rpc_calls: Option<IntCounterVec>,
    pub db_query_duration_seconds: Option<Histogram>,
    pub api_errors: Option<IntCounterVec>,
}

impl BusinessMetrics {
    pub fn new(registry: &Registry) -> Self {
        Self {
            bounties_created: make_counter(
                registry,
                "stellar_bounties_created_total",
                opts!(
                    "stellar_bounties_created_total",
                    "Total number of bounties created"
                ),
            ),
            applications_submitted: make_counter(
                registry,
                "stellar_applications_submitted_total",
                opts!(
                    "stellar_applications_submitted_total",
                    "Total number of bounty applications submitted"
                ),
            ),
            freelancers_registered: make_counter(
                registry,
                "stellar_freelancers_registered_total",
                opts!(
                    "stellar_freelancers_registered_total",
                    "Total number of freelancers registered"
                ),
            ),
            escrows_released: make_counter(
                registry,
                "stellar_escrows_released_total",
                opts!(
                    "stellar_escrows_released_total",
                    "Total number of escrows released"
                ),
            ),
            escrows_deposits: make_counter_vec(
                registry,
                "stellar_escrows_deposits_total",
                opts!(
                    "stellar_escrows_deposits_total",
                    "Total escrow deposits by token"
                ),
                &["token"],
            ),
            dispute_resolution_seconds: make_histogram(
                registry,
                "stellar_dispute_resolution_seconds",
                HistogramOpts::new(
                    "stellar_dispute_resolution_seconds",
                    "Time taken to resolve disputes",
                ),
            ),
            stellar_rpc_calls: make_counter_vec(
                registry,
                "stellar_rpc_calls_total",
                opts!(
                    "stellar_rpc_calls_total",
                    "Total number of Stellar RPC calls by method and status"
                ),
                &["method", "status"],
            ),
            db_query_duration_seconds: make_histogram(
                registry,
                "db_query_duration_seconds",
                HistogramOpts::new(
                    "db_query_duration_seconds",
                    "Database query duration by query type",
                ),
            ),
            api_errors: make_counter_vec(
                registry,
                "stellar_api_errors_total",
                opts!(
                    "stellar_api_errors_total",
                    "Total API errors by endpoint and status code"
                ),
                &["endpoint", "status"],
            ),
        }
    }
}

/// Build the Prometheus middleware and register custom business metrics.
/// Returns the middleware (to wrap the App) and the business metrics (to share via app_data),
/// or an error message if the middleware itself failed to build.
pub fn setup_metrics() -> Result<(actix_web_prom::PrometheusMetrics, BusinessMetrics), String> {
    let prometheus = PrometheusMetricsBuilder::new("stellar_api")
        .endpoint("/metrics")
        .build()
        .map_err(|e| format!("failed to build Prometheus metrics middleware: {}", e))?;

    let business = BusinessMetrics::new(&prometheus.registry);

    Ok((prometheus, business))
}
