#########
# Route 53 override so VPC/S2S clients hit the VPCE hostname
#########
resource "aws_route53_zone" "s3_private_zone" {
  name = "s3.${var.region}.amazonaws.com"

  vpc {
    vpc_id = var.vpc_id
  }
}

locals {
  vpce_primary_dns_entry = tolist(aws_vpc_endpoint.s3_interface.dns_entry)[0]
}

resource "aws_route53_record" "bucket_vpce_alias" {
  zone_id = aws_route53_zone.s3_private_zone.zone_id
  name    = local.bucket_name
  type    = "A"

  alias {
    name                   = local.vpce_primary_dns_entry.dns_name
    zone_id                = local.vpce_primary_dns_entry.hosted_zone_id
    evaluate_target_health = false
  }
}
