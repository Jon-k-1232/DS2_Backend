terraform { 
  cloud { 
    organization = "Jon_Kimmel" 

    workspaces { 
      name = "ds2-db-lambda-prod" 
    } 
  }

  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-west-2"
}
