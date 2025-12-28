#########
# Publish a custom record in a private zone you control (re-use existing zone if supplied)
#########
resource "aws_route53_zone" "internal" {
  count = var.manage_dns && var.create_private_zone ? 1 : 0
  name  = var.private_zone_name

  vpc {
    vpc_id = var.vpc_id
  }
}

data "aws_route53_zone" "existing" {
  count        = (var.manage_dns && !var.create_private_zone && var.existing_private_zone_id != null) ? 1 : 0
  zone_id      = var.existing_private_zone_id
  private_zone = true
}

data "aws_route53_zone" "lookup" {
  count        = (var.manage_dns && !var.create_private_zone && var.existing_private_zone_id == null) ? 1 : 0
  name         = var.private_zone_name
  private_zone = true
}

locals {
  selected_zone_id = var.manage_dns ? (
    var.create_private_zone ?
      try(aws_route53_zone.internal[0].zone_id, null) :
      (var.existing_private_zone_id != null ?
        try(data.aws_route53_zone.existing[0].zone_id, null) :
        try(data.aws_route53_zone.lookup[0].zone_id, null)
      )
  ) : null

  selected_zone_name = var.manage_dns ? (
    var.create_private_zone ?
      try(aws_route53_zone.internal[0].name, null) :
      (var.existing_private_zone_id != null ?
        try(data.aws_route53_zone.existing[0].name, null) :
        try(data.aws_route53_zone.lookup[0].name, null)
      )
  ) : null

  # Interface endpoint removed - DNS alias no longer needed
}

# DNS alias removed - applications use standard S3 endpoint instead
