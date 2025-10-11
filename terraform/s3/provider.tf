#########
# Provider
#########
terraform {
  cloud {
    organization = "Jon_Kimmel"

    workspaces {
      name = "DS_2_s3"
    }
  }
}

provider "aws" {
  region = var.region
}
 
