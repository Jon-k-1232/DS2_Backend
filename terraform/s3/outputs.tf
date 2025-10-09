output "ds2_bucket_iam_user" {
  description = "IAM user with access to the DS2 bucket."
  value       = aws_iam_user.ds2_bucket_user.name
}

output "ds2_bucket_access_key_id" {
  description = "Access key ID for the DS2 bucket IAM user."
  value       = aws_iam_access_key.ds2_bucket_user_key.id
  sensitive   = true
}

output "ds2_bucket_secret_access_key" {
  description = "Secret access key for the DS2 bucket IAM user. Capture this securely; Terraform state retains a copy."
  value       = aws_iam_access_key.ds2_bucket_user_key.secret
  sensitive   = true
}
