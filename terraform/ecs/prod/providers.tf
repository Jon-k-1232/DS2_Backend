terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }

  cloud {
    organization = "Jon_Kimmel"

    workspaces {
      name = "ds2-backend-ecs-prod"
    }
  }
}

provider "aws" {
  region = var.aws_region
}
