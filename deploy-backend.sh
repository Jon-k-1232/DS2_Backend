#!/bin/bash

# DS2 Backend Deployment Script
# This script builds and pushes the Docker image to ECR and updates the ECS service
#
# DEPRECATED (2026-09-22): deploy-all.sh calls deploy.sh, not this script —
# this one isn't part of the real deploy path and has drifted from it (no
# AWS_PROFILE, no version tag for rollback, no pre-deploy stop-task, no
# post-deploy wait). Prefer `bash deploy.sh` (or `bash ../deploy-all.sh` from
# the repo root for backend+frontend together). The --platform flag below was
# added as a safety net for anyone who runs this directly anyway: without it,
# building on Apple Silicon pushes an arm64 image to the x86_64 ECS EC2 hosts
# (DS2_Backend/terraform/backend/main.tf's aws_ami filter is
# amzn2-ami-ecs-hvm-*-x86_64-ebs) and the task fails to start.

set -e

echo "=== DS2 Backend Deployment ==="

# Variables
AWS_REGION="us-west-2"
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REPOSITORY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/ds2-prod-backend"
CLUSTER_NAME="ds2-prod-ecs-cluster"
SERVICE_NAME="ds2-prod-backend-service"

# Login to ECR
echo "Logging into ECR..."
aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${ECR_REPOSITORY}

# Build the Docker image
# --platform linux/amd64: the ECS hosts are x86_64; building natively on an
# Apple Silicon Mac without this flag produces an arm64 image that pushes and
# deploys "successfully" but fails to start on ECS (matches deploy.sh).
echo "Building Docker image..."
docker build --platform linux/amd64 -t ds2-backend:latest .

# Tag the image
echo "Tagging image..."
docker tag ds2-backend:latest ${ECR_REPOSITORY}:latest

# Push to ECR
echo "Pushing image to ECR..."
docker push ${ECR_REPOSITORY}:latest

# Force new deployment
echo "Forcing ECS service deployment..."
aws ecs update-service --cluster ${CLUSTER_NAME} --service ${SERVICE_NAME} --force-new-deployment --region ${AWS_REGION}

echo "=== Deployment initiated successfully ==="
echo "Monitor deployment with: aws ecs describe-services --cluster ${CLUSTER_NAME} --services ${SERVICE_NAME} --region ${AWS_REGION}"
