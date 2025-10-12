output "ds2_bucket_iam_user" {
  description = "IAM user with access to the DS2 bucket."
  value       = aws_iam_user.ds2_bucket_user.name
}

output "ds2_bucket_access_key_id" {
  description = "Access key ID for the DS2 bucket IAM user."
  value       = aws_iam_access_key.ds2_bucket_user_key.id
  sensitive   = true
}

output "route53_inbound_resolver_ips" {
  description = "IP addresses of the Route 53 inbound resolver endpoint for DNS forwarding."
  value       = aws_route53_resolver_endpoint.ds2_inbound.ip_address[*].ip
}

output "s3_interface_dns_names" {
  description = "DNS names published by the S3 interface endpoint. Use a bucket.vpce-* hostname for TLS connections."
  value       = [for entry in aws_vpc_endpoint.s3_interface.dns_entry : entry.dns_name]
}

output "bucket_name" {
  description = "Name of the DS2 dev bucket (use for S3_BUCKET_NAME)."
  value       = aws_s3_bucket.app_bucket.id
}

output "bucket_private_alias" {
  description = "Internal Route53 alias pointing at the interface endpoint (use as S3_ENDPOINT if you prefer the friendly name)."
  value       = var.manage_dns ? try(aws_route53_record.ds2_bucket_alias[0].fqdn, null) : null
}

output "bucket_interface_https_endpoint" {
  description = "Interface endpoint URL suitable for S3_ENDPOINT when you need the direct VPCE host."
  value       = "https://${tolist(aws_vpc_endpoint.s3_interface.dns_entry)[0].dns_name}"
}

output "s3_gateway_endpoint_id" {
  description = "ID of the S3 gateway endpoint associated with the bucket access (existing or newly created)."
  value       = var.create_s3_gateway_endpoint ? aws_vpc_endpoint.s3_gateway[0].id : var.existing_s3_gateway_endpoint_id
}
