# Prompt Optimization Refinements (Throxy)

This file documents the refinements we selected for automatic prompt optimization and why they matter for this project.

## 1) Train/test split by company

**What it is:** split the evaluation set by company into a training subset (used during prompt search) and a holdout subset (used only for final reporting).

**Why we chose it:** our evaluation set is small and noisy. Optimizing directly on the full set risks overfitting to the quirks of a handful of companies. A company-level split prevents leakage between train and test and gives a more honest read on whether a prompt generalizes.

## 2) APO-style error summary ("textual gradients")

**What it is:** in addition to raw failure examples, we summarize common error patterns (e.g., "over-ranking marketing titles vs expected sales leadership"). This summary is provided to the optimizer as guidance for the next prompt revision.

**Why we chose it:** failure examples alone can be sparse and brittle. A compact, aggregated error summary tends to yield more directed prompt edits, mirroring the "textual gradient" idea in APO/ProTeGi.

---

We prioritized these two refinements because they are low-cost to implement and align well with our current optimization loop (OPRO-style candidate generation + evaluation).

## 3) Heuristic prompt mutations (GRIPS-style diversity)

**What it is:** generate a small number of deterministic prompt variants (e.g., swapping output constraints or adding priority lines) alongside LLM-proposed prompts.

**Why we chose it:** it increases search diversity without extra API calls and helps avoid premature convergence on a single wording.

## 4) Objective alignment (default to Precision@k)

**What it is:** default the optimization objective to precision at k (or top1), which matches our business goal of selecting the right top leads per company.

**Why we chose it:** NDCG is useful but can overweight the tail. Precision/top1 better reflect what the UI exports and what the sales team will action.

## 5) Feature parity (optional employee range in eval)

**What it is:** allow the eval documents to include employee range when desired.

**Why we chose it:** the persona spec heavily conditions on company size. This flag lets us test whether size signals improve ranking without forcing production changes.
