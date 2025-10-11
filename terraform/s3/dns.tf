#########
# Publish a custom record in a private zone you control
#########
resource "aws_route53_zone" "internal" {
  name = var.private_zone_name

  vpc {
    vpc_id = var.vpc_id
  }
}

locals {
  vpce_entry = tolist(aws_vpc_endpoint.s3_interface.dns_entry)[0]
}

resource "aws_route53_record" "ds2_bucket_alias" {
  zone_id = aws_route53_zone.internal.zone_id
  name    = "ds2-bucket.${aws_route53_zone.internal.name}"
  type    = "A"

  alias {
    name                   = local.vpce_entry.dns_name
    zone_id                = local.vpce_entry.hosted_zone_id
    evaluate_target_health = false
  }
}
