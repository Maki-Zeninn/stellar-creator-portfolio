mod config;
mod models;
mod email;
mod sms;
mod push;
mod dispatcher;

use crate::config::Settings;
use crate::dispatcher::NotificationDispatcher;
use crate::models::{Notification, NotificationChannel};
use actix_web::{middleware, web, App, HttpResponse, HttpServer};
use std::time::{SystemTime, UNIX_EPOCH};
use tracing_subscriber::fmt::format::FmtSpan;

/// Liveness probe — returns 200 if the process is running.
async fn health() -> HttpResponse {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    HttpResponse::Ok().json(serde_json::json!({
        "status": "ok",
        "timestamp": timestamp
    }))
}

/// Readiness probe — the notifications service has no external DB dependency;
/// it is ready as soon as the dispatcher is initialised.
async fn ready() -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "db": "ok",
        "stellar_rpc": "ok",
        "cache": "ok"
    }))
}

/// Resolve the host/port the health-check server should bind to from raw
/// env var values. Pulled out as a pure function so bootstrap parsing can be
/// unit tested without touching real process environment state.
fn resolve_server_config(port_var: Option<&str>, host_var: Option<&str>) -> (String, u16) {
    let port = port_var
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(3003);
    let host = host_var
        .map(str::to_string)
        .unwrap_or_else(|| "0.0.0.0".to_string());
    (host, port)
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize structured logging
    tracing_subscriber::fmt()
        .with_env_filter(std::env::var("RUST_LOG").unwrap_or_else(|_| "info,stellar_notifications=debug".into()))
        .with_span_events(FmtSpan::CLOSE)
        .init();

    tracing::info!("Starting Stellar Notifications Service");

    // Load and validate configuration
    let settings = Settings::from_env()?;
    settings.validate()?;

    // Initialize the dispatcher
    let dispatcher = NotificationDispatcher::new(settings.clone())?;

    // Initial service startup check
    tracing::info!("Notifications Service initialized and ready");

    // In a production environment, this would listen to a Message Queue (e.g. Redis).
    // For this implementation, we demonstrate the dispatcher with a test notification 
    // if a special environment variable is set.
    if std::env::var("SEND_TEST_NOTIFICATION").is_ok() {
        let test_notification = Notification {
            user_id: "system-test".to_string(),
            channel: NotificationChannel::Email,
            recipient: "test@example.com".to_string(),
            subject: Some("Stellar Service Test".to_string()),
            message: "This is a test notification from the Stellar Creator Portfolio service.".to_string(),
        };

        if let Err(e) = dispatcher.dispatch(test_notification).await {
             tracing::error!("Test notification delivery failed: {}", e);
        }
    }

    // Start the HTTP server for health/readiness probes in the background
    let (host, port) = resolve_server_config(
        std::env::var("NOTIFICATIONS_PORT").ok().as_deref(),
        std::env::var("NOTIFICATIONS_HOST").ok().as_deref(),
    );

    tracing::info!("Health endpoints available on {}:{}", host, port);

    let server = HttpServer::new(|| {
        App::new()
            .wrap(middleware::Logger::default())
            .route("/health", web::get().to(health))
            .route("/ready", web::get().to(ready))
    })
    .bind((host.as_str(), port))?
    .run();

    // Keep the service alive (listening for events + serving health probes)
    tracing::info!("Service is now running");

    server.await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_server_config_uses_provided_values() {
        let (host, port) = resolve_server_config(Some("8080"), Some("127.0.0.1"));
        assert_eq!(host, "127.0.0.1");
        assert_eq!(port, 8080);
    }

    #[test]
    fn resolve_server_config_defaults_when_missing() {
        let (host, port) = resolve_server_config(None, None);
        assert_eq!(host, "0.0.0.0");
        assert_eq!(port, 3003);
    }

    #[test]
    fn resolve_server_config_falls_back_on_malformed_port() {
        let (host, port) = resolve_server_config(Some("not-a-port"), None);
        assert_eq!(host, "0.0.0.0");
        assert_eq!(port, 3003);
    }

    #[test]
    fn resolve_server_config_falls_back_on_out_of_range_port() {
        let (_, port) = resolve_server_config(Some("999999"), None);
        assert_eq!(port, 3003);
    }

    #[test]
    fn resolve_server_config_uses_custom_host_with_default_port() {
        let (host, port) = resolve_server_config(None, Some("192.168.1.1"));
        assert_eq!(host, "192.168.1.1");
        assert_eq!(port, 3003);
    }
}
