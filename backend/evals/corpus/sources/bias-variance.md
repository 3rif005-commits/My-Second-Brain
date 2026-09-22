[section 1]
# Lecture 4 — Bias, Variance and Model Capacity

Observed error decomposes into three parts: bias squared, variance, and an
irreducible noise term. The irreducible term comes from the data-generating
process and no model can remove it.

Bias is the error from wrong assumptions in the learner. A linear model fitted
to a curved relationship is biased no matter how much data it sees.

Variance is how much the fitted function changes when the training set changes.
A deep decision tree has low bias and high variance.

[section 2]
## The decomposition

E[(y - f_hat(x))^2] = Bias[f_hat(x)]^2 + Var[f_hat(x)] + sigma^2

Where sigma^2 is the irreducible error. In practice we estimate the first two
terms by resampling: train on many bootstrap samples and measure the spread of
predictions at a fixed x.

[section 3]
## Capacity and the U-curve

As capacity grows, bias falls and variance rises. Total error traces a U shape:
underfitting on the left, overfitting on the right, the sweet spot between.

| Model            | Bias | Variance | Typical remedy        |
|------------------|------|----------|-----------------------|
| Linear regression| High | Low      | add features          |
| Deep tree        | Low  | High     | prune, bag            |
| k-NN, small k    | Low  | High     | raise k               |

[section 4]
## Remedies

Regularisation trades a little bias for a large drop in variance — ridge
regression shrinks coefficients toward zero. Bagging averages many high
variance learners. More training data reduces variance but never bias.

Exam note: students routinely claim more data fixes bias. It does not.
