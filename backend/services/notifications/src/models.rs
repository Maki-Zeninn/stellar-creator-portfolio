use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[allow(clippy::upper_case_acronyms)] // `SMS` is part of the serde wire format; renaming would be a breaking change
pub enum NotificationChannel {
    Email,
    SMS,
    Push,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notification {
    pub user_id: String,
    pub channel: NotificationChannel,
    pub recipient: String,
    pub subject: Option<String>,
    pub message: String,
}

#[derive(Debug, thiserror::Error)]
pub enum NotificationError {
    #[error("Configuration error: {0}")]
    Config(String),
    #[error("Delivery failed for channel {channel:?}: {reason}")]
    Delivery {
        channel: NotificationChannel,
        reason: String,
    },
    #[error("Rate limited")]
    #[allow(dead_code)] // reserved for future rate-limiting support
    RateLimited,
    #[error("Invalid recipient: {0}")]
    InvalidRecipient(String),
    #[error("Internal error: {0}")]
    Internal(String),
}

pub type Result<T> = std::result::Result<T, NotificationError>;
