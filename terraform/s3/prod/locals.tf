locals {
  bucket_name = "ds2-${var.account_id}"

  s3_folder_keys = [
    "James_F__Kimmel___Associates/",
    "James_F__Kimmel___Associates/app/",
    "James_F__Kimmel___Associates/app/assets/",
    "James_F__Kimmel___Associates/invoicing/",
    "James_F__Kimmel___Associates/invoicing/csv_report/",
    "James_F__Kimmel___Associates/invoicing/csv_report_and_draft_invoices/",
    "James_F__Kimmel___Associates/invoicing/draft_invoices/",
    "James_F__Kimmel___Associates/invoicing/final_invoices/",
    "James_F__Kimmel___Associates/invoicing/invoice_images/",
    "James_F__Kimmel___Associates/time_tracking/",
    "James_F__Kimmel___Associates/time_tracking/Pending/",
    "James_F__Kimmel___Associates/time_tracking/Processed/",
    "James_F__Kimmel___Associates/time_tracking/Processing/",
    "James_F__Kimmel___Associates/time_tracking/Timesheet_Errors/",
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
