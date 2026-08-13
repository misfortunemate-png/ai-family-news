#!/bin/sh
set -e
DRY_RUN=${DRY_RUN:-1}
export DRY_RUN
node scripts/collect.mjs
node scripts/select.mjs
node scripts/stats.mjs
