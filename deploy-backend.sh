#!/bin/bash

# DS2 Backend Deployment Script
# This script builds and pushes the Docker image to ECR and updates the ECS service

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
echo "Building Docker image..."
docker build -t ds2-backend:latest .

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
