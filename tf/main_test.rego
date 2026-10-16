package terraform.repository

import rego.v1

test_missing_project if count(deny) == 1 with input as {}

test_empty_modules if count(deny) == 1 with input as {"module": {}}

test_unrelated_resource if count(deny) == 1 with input as {"resource": {"terraform_data": {"main": [{}]}}}
