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
