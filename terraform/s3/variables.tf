variable "region" {
  default = "us-west-2"
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

# Your on-prem/VLAN CIDRs that reach AWS over the VPN
variable "onprem_cidrs" {
  type = list(string)
}
