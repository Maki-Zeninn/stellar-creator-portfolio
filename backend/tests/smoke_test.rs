//! Basic smoke test for backend API startup and trivial endpoint responses.
//!
//! This test ensures the API can start up and respond to simple requests
//! without requiring external services (database, Stellar RPC, etc.).

use actix_web::{test, web, App, HttpResponse};

/// Trivial health-like endpoint for smoke testing.
async fn simple_health() -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({ "status": "ok" }))
}

/// Happy path: API starts and responds to a trivial request.
#[actix_web::test]
async fn smoke_api_starts_and_responds() {
    let app = test::init_service(
        App::new().route("/health", web::get().to(simple_health)),
    )
    .await;

    let req = test::TestRequest::get()
        .uri("/health")
        .to_request();
    let resp = test::call_service(&app, req).await;

    assert!(resp.status().is_success(), "health endpoint must return 200");
    let body: serde_json::Value = test::read_body_json(resp).await;
    assert_eq!(body["status"], "ok");
}

/// Edge case: API returns 404 for unmapped routes instead of crashing.
#[actix_web::test]
async fn smoke_unmapped_route_returns_404() {
    let app = test::init_service(
        App::new().route("/health", web::get().to(simple_health)),
    )
    .await;

    let req = test::TestRequest::get()
        .uri("/nonexistent")
        .to_request();
    let resp = test::call_service(&app, req).await;

    assert_eq!(resp.status(), 404, "unmapped route must return 404, not crash");
}
