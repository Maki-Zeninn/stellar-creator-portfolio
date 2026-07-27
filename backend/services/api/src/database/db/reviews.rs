use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ReviewSubmission {
    #[serde(rename = "bountyId")]
    pub bounty_id: String,
    #[serde(rename = "creatorId")]
    pub creator_id: String,
    pub rating: u8,
    pub title: String,
    pub body: String,
    #[serde(rename = "reviewerName")]
    pub reviewer_name: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Review {
    pub id: String,
    pub bounty_id: String,
    pub creator_id: String,
    pub rating: u8,
    pub title: String,
    pub body: String,
    pub reviewer_name: String,
    pub created_at: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ReviewAggregation {
    pub total_reviews: u32,
    pub average_rating: f64,
    pub rating_distribution: [u32; 5], // 1-star, 2-star, 3-star, 4-star, 5-star counts
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct CreatorReputationPayload {
    pub creator_id: String,
    pub aggregation: ReviewAggregation,
    pub recent_reviews: Vec<Review>,
}

pub fn get_mock_reviews() -> Vec<Review> {
    vec![
        Review {
            id: "rev-alex-studio-b-1".to_string(),
            bounty_id: "b-1".to_string(),
            creator_id: "alex-studio".to_string(),
            rating: 5,
            title: "Excellent design work".to_string(),
            body: "Alex delivered outstanding designs that exceeded our expectations. Very professional and responsive.".to_string(),
            reviewer_name: "John D.".to_string(),
            created_at: "2026-01-15T10:30:00Z".to_string(),
        },
        Review {
            id: "rev-alex-studio-b-2".to_string(),
            bounty_id: "b-2".to_string(),
            creator_id: "alex-studio".to_string(),
            rating: 4,
            title: "Great collaboration".to_string(),
            body: "Good communication and solid design work. Would work with again.".to_string(),
            reviewer_name: "Sarah M.".to_string(),
            created_at: "2026-01-10T14:20:00Z".to_string(),
        },
        Review {
            id: "rev-jordan-dev-b-1".to_string(),
            bounty_id: "b-3".to_string(),
            creator_id: "jordan-dev".to_string(),
            rating: 5,
            title: "Flawless implementation".to_string(),
            body: "Jordan implemented the API integration perfectly. Clean code and great documentation.".to_string(),
            reviewer_name: "Mike R.".to_string(),
            created_at: "2026-01-12T09:15:00Z".to_string(),
        },
    ]
}

pub fn reviews_for_creator(creator_id: &str) -> Vec<Review> {
    let reviews = get_mock_reviews();
    reviews
        .into_iter()
        .filter(|review| review.creator_id == creator_id)
        .collect()
}

pub fn aggregate_reviews(reviews: &[Review]) -> ReviewAggregation {
    let total_reviews = reviews.len() as u32;
    
    if total_reviews == 0 {
        return ReviewAggregation {
            total_reviews: 0,
            average_rating: 0.0,
            rating_distribution: [0, 0, 0, 0, 0],
        };
    }
    
    let sum_rating: f64 = reviews.iter().map(|r| r.rating as f64).sum();
    let average_rating = sum_rating / total_reviews as f64;
    
    let mut rating_distribution = [0u32; 5];
    for review in reviews {
        if review.rating >= 1 && review.rating <= 5 {
            rating_distribution[(review.rating - 1) as usize] += 1;
        }
    }
    
    ReviewAggregation {
        total_reviews,
        average_rating,
        rating_distribution,
    }
}

pub fn recent_reviews(reviews: &[Review], limit: usize) -> Vec<Review> {
    let mut sorted_reviews = reviews.to_vec();
    sorted_reviews.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    sorted_reviews.into_iter().take(limit).collect()
}

pub fn submit_review(submission: ReviewSubmission) -> Result<Review, String> {
    // Validate the submission
    if submission.bounty_id.trim().is_empty() {
        return Err("Bounty ID is required".to_string());
    }
    if submission.creator_id.trim().is_empty() {
        return Err("Creator ID is required".to_string());
    }
    if !(1..=5).contains(&submission.rating) {
        return Err("Rating must be between 1 and 5".to_string());
    }
    if submission.title.trim().is_empty() {
        return Err("Title is required".to_string());
    }
    if submission.body.trim().is_empty() {
        return Err("Feedback is required".to_string());
    }
    if submission.reviewer_name.trim().is_empty() {
        return Err("Your name is required".to_string());
    }
    
    // Create the review
    let review_id = format!("rev-{}-{}", submission.creator_id, submission.bounty_id);
    Ok(Review {
        id: review_id,
        bounty_id: submission.bounty_id,
        creator_id: submission.creator_id,
        rating: submission.rating,
        title: submission.title,
        body: submission.body,
        reviewer_name: submission.reviewer_name,
        created_at: chrono_now(),
    })
}

fn chrono_now() -> String {
    // Stable timestamp placeholder — real impl would use chrono or time crate
    "2026-01-01T00:00:00Z".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_submission() -> ReviewSubmission {
        ReviewSubmission {
            bounty_id: "b-9".to_string(),
            creator_id: "alex-studio".to_string(),
            rating: 5,
            title: "Great work".to_string(),
            body: "Excellent job!".to_string(),
            reviewer_name: "Test Reviewer".to_string(),
        }
    }

    #[test]
    fn reviews_for_creator_returns_empty_for_unknown_creator() {
        assert!(reviews_for_creator("unknown-creator").is_empty());
    }

    #[test]
    fn aggregate_reviews_of_empty_slice_is_zeroed() {
        let aggregation = aggregate_reviews(&[]);
        assert_eq!(aggregation.total_reviews, 0);
        assert_eq!(aggregation.average_rating, 0.0);
        assert_eq!(aggregation.rating_distribution, [0, 0, 0, 0, 0]);
    }

    #[test]
    fn aggregate_reviews_computes_distribution_and_average() {
        let reviews = reviews_for_creator("alex-studio");
        let aggregation = aggregate_reviews(&reviews);
        assert_eq!(aggregation.total_reviews, 2);
        assert_eq!(aggregation.average_rating, 4.5);
        assert_eq!(aggregation.rating_distribution, [0, 0, 0, 1, 1]);
    }

    #[test]
    fn recent_reviews_respects_limit_and_sorts_newest_first() {
        let reviews = get_mock_reviews();
        let recent = recent_reviews(&reviews, 2);
        assert_eq!(recent.len(), 2);
        assert_eq!(recent[0].id, "rev-alex-studio-b-1");
        assert_eq!(recent[1].id, "rev-jordan-dev-b-1");
    }

    #[test]
    fn submit_review_rejects_empty_bounty_id() {
        let mut submission = valid_submission();
        submission.bounty_id = "  ".to_string();
        assert_eq!(submit_review(submission).unwrap_err(), "Bounty ID is required");
    }

    #[test]
    fn submit_review_rejects_empty_creator_id() {
        let mut submission = valid_submission();
        submission.creator_id = "".to_string();
        assert_eq!(submit_review(submission).unwrap_err(), "Creator ID is required");
    }

    #[test]
    fn submit_review_rejects_out_of_range_rating() {
        let mut too_low = valid_submission();
        too_low.rating = 0;
        assert_eq!(submit_review(too_low).unwrap_err(), "Rating must be between 1 and 5");

        let mut too_high = valid_submission();
        too_high.rating = 6;
        assert_eq!(submit_review(too_high).unwrap_err(), "Rating must be between 1 and 5");
    }

    #[test]
    fn submit_review_rejects_empty_title_body_or_reviewer_name() {
        let mut no_title = valid_submission();
        no_title.title = " ".to_string();
        assert_eq!(submit_review(no_title).unwrap_err(), "Title is required");

        let mut no_body = valid_submission();
        no_body.body = "".to_string();
        assert_eq!(submit_review(no_body).unwrap_err(), "Feedback is required");

        let mut no_reviewer = valid_submission();
        no_reviewer.reviewer_name = "  ".to_string();
        assert_eq!(submit_review(no_reviewer).unwrap_err(), "Your name is required");
    }

    #[test]
    fn submit_review_accepts_valid_submission() {
        let review = submit_review(valid_submission()).expect("valid submission should succeed");
        assert_eq!(review.id, "rev-alex-studio-b-9");
        assert_eq!(review.rating, 5);
    }
}
