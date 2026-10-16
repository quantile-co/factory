package terraform.project

import rego.v1

test_missing_project if count(deny) == 4 with input as {}

test_empty_project if count(deny) == 4 with input as {"resource": {}, "data": {}}

test_unrelated_resource if count(deny) == 4 with input as {"resource": {"terraform_data": {"main": [{}]}}}
