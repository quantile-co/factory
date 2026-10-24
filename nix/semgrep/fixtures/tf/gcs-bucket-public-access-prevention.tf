# ruleid: terraform-bucket-public-access-prevention
resource "google_storage_bucket" "missing" {
  name     = "fixture-missing"
  location = "US"
}

# ruleid: terraform-bucket-public-access-prevention
resource "google_storage_bucket" "inherited" {
  name                     = "fixture-inherited"
  location                 = "US"
  public_access_prevention = "inherited"
}

# ok: terraform-bucket-public-access-prevention
resource "google_storage_bucket" "protected" {
  name                     = "fixture-protected"
  location                 = "US"
  public_access_prevention = "enforced"
}

# ok: terraform-bucket-public-access-prevention
resource "google_storage_bucket" "reordered" {
  public_access_prevention = "enforced"
  name                     = "fixture-reordered"
  location                 = "US"
}

# ok: terraform-bucket-public-access-prevention
resource "google_project" "not_a_bucket" {
  name       = "fixture"
  project_id = "fixture"
}
