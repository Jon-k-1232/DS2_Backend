terraform {
  cloud {
    organization = "Jon_Kimmel"

    workspaces {
      name = "ds2-backend-prod"
    }
  }
}
