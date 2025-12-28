#########
# Publish a custom record in a private zone you control
#########
resource "aws_route53_zone" "internal" {
  name = var.private_zone_name

  vpc {
    vpc_id = var.vpc_id
  }
}

# Interface endpoint removed - DNS alias no longer needed
# Applications use standard S3 endpoint which automatically routes through Gateway endpoint

