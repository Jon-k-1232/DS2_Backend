terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  cloud {
    organization = "Jon_Kimmel"

    workspaces {
      name = "ds2-database-prod"
    }
  }
}

provider "aws" {
  region = var.aws_region
}
