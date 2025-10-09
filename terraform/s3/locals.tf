locals {
  bucket_name = "ds2-${var.account_id}"

  s3_folder_keys = [
    "app/",
    "app/assets/",
    "time_trackers/",
    "time_trackers/csv_report/",
    "time_trackers/csv_report_and_draft_invoices/",
    "time_trackers/draft_invoices/",
    "time_trackers/final_invoices/",
    "time_trackers/invoice_images/",
  ]

  bucket_data_actions = [
    "s3:GetObject",
    "s3:GetObjectVersion",
    "s3:PutObject",
    "s3:DeleteObject",
    "s3:DeleteObjectVersion",
    "s3:ListBucket",
    "s3:ListBucketVersions",
  ]
}
