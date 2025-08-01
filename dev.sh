#!/bin/bash

# Load environment variables
set -a
source .env
set +a

# Run wrangler dev with loaded environment
wrangler dev