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
    "invoicing/",
    "invoicing/csv_report/",
    "invoicing/csv_report_and_draft_invoices/",
    "invoicing/draft_invoices/",
    "invoicing/final_invoices/",
    "invoicing/invoice_images/",
    "time_tracking/",
    "time_tracking/Pending/",
    "time_tracking/Processed/",
    "time_tracking/Processing/",
    "time_tracking/Timesheet_Errors/",
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
