terraform {
  cloud {
    organization = "Jon_Kimmel"

    workspaces {
      name = "DS2_s3_Dev"
    }
  }
}

provider "aws" {
  region = var.region
}
 
