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
  description = "Secret access key for the DS2 bucket IAM user."
  value       = aws_iam_access_key.ds2_bucket_user_key.secret
  sensitive   = true
}

# Interface endpoint outputs removed - using Gateway endpoint

output "bucket_name" {
  description = "Name of the DS2 prod bucket (use for S3_BUCKET_NAME)."
  value       = aws_s3_bucket.app_bucket.id
}

output "standard_s3_endpoint" {
  description = "Standard S3 endpoint URL for the region (use for S3_ENDPOINT). Will automatically use Gateway endpoint."
  value       = "https://s3.${var.region}.amazonaws.com"
}

output "s3_gateway_endpoint_id" {
  description = "ID of the S3 gateway endpoint associated with the bucket access."
  value       = aws_vpc_endpoint.s3_gateway.id
}
