-- Add confidence tracking to lead_rankings
alter table public.lead_rankings
  add column if not exists confidence numeric,
  add column if not exists axis_scores jsonb,
  add column if not exists needs_review boolean not null default false;

-- Index for flagged rankings that need review
create index if not exists lead_rankings_needs_review_idx
  on public.lead_rankings (needs_review) where needs_review = true;

-- Comment explaining confidence calculation
comment on column public.lead_rankings.confidence is
  'Confidence score 0-1 based on axis score variance and score certainty. Low confidence (<0.5) suggests manual review.';

comment on column public.lead_rankings.axis_scores is
  'Individual axis scores from LLM: {role, seniority, industry, size, data_quality} each 0-5';

comment on column public.lead_rankings.needs_review is
  'Flag for low-confidence rankings that should be manually reviewed';
