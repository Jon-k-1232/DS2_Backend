data "aws_subnet" "ds2_private" {
  for_each = toset(var.private_subnet_ids)
  id       = each.value
}

locals {
  ds2_private_subnet_cidrs = [for subnet in data.aws_subnet.ds2_private : subnet.cidr_block]
}

resource "aws_security_group" "ds2_to_s3" {
  name        = "ds2-s3-access"
  description = "Allow DS2 services to reach S3 via the VPC endpoint"
  vpc_id      = var.vpc_id

  ingress {
    description = "Allow HTTPS from private subnets and approved on-prem networks"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = concat(
      local.ds2_private_subnet_cidrs,
      var.onprem_cidrs
    )
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "ds2-s3-access"
  }
}

resource "aws_vpc_endpoint" "s3_interface" {
  vpc_id             = var.vpc_id
  service_name       = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type  = "Interface"
  subnet_ids         = var.private_subnet_ids
  security_group_ids = [aws_security_group.ds2_to_s3.id]

  # If you do NOT have on-prem DNS forwarding into Route 53,
  # leave Private DNS disabled and point your client at the VPCe DNS name.
  private_dns_enabled = false

  tags = {
    Name = "s3-interface-endpoint"
  }
}

data "aws_iam_policy_document" "vpce_policy" {
  statement {
    sid     = "AllowThisBucketOnly"
    effect  = "Allow"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.app_bucket.arn,
      "${aws_s3_bucket.app_bucket.arn}/*"
    ]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
  }
}

resource "aws_vpc_endpoint_policy" "s3_vpce_policy" {
  vpc_endpoint_id = aws_vpc_endpoint.s3_interface.id
  policy          = data.aws_iam_policy_document.vpce_policy.json
}
