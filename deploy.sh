#!/bin/bash
set -e

AWS_REGION="us-west-2"
AWS_PROFILE="JKA_JonKimmel_Admin"
CLUSTER="ds2-prod-ecs-cluster"
SERVICE="ds2-prod-backend-service"
ECR_REPO="ds2-prod-backend"

echo "=== DS2 Backend Deploy ==="

# Get account ID
ACCOUNT_ID=$(/usr/local/aws-cli/aws sts get-caller-identity --query Account --output text --profile $AWS_PROFILE)
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}"

echo "  Account:  $ACCOUNT_ID"
echo "  ECR:      $ECR_URI"
echo "  Cluster:  $CLUSTER"
echo "  Service:  $SERVICE"
echo ""

# Login to ECR
echo "[1/4] Logging into ECR..."
/usr/local/aws-cli/aws ecr get-login-password --region $AWS_REGION --profile $AWS_PROFILE | \
  docker login --username AWS --password-stdin ${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com

# Build
echo "[2/4] Building image..."
docker build --platform linux/amd64 --no-cache -t ${ECR_REPO}:latest .

# Push
echo "[3/4] Pushing to ECR..."
docker tag ${ECR_REPO}:latest ${ECR_URI}:latest
docker push ${ECR_URI}:latest

# Deploy
echo "[4/4] Deploying to ECS..."
TASK_ARN=$(/usr/local/aws-cli/aws ecs list-tasks --cluster $CLUSTER --service-name $SERVICE \
  --region $AWS_REGION --profile $AWS_PROFILE --query 'taskArns[0]' --output text 2>/dev/null)

if [ "$TASK_ARN" != "None" ] && [ -n "$TASK_ARN" ]; then
  /usr/local/aws-cli/aws ecs stop-task --cluster $CLUSTER --task $TASK_ARN \
    --reason "Deploy new image" --region $AWS_REGION --profile $AWS_PROFILE > /dev/null 2>&1
fi

/usr/local/aws-cli/aws ecs update-service --cluster $CLUSTER --service $SERVICE \
  --force-new-deployment --region $AWS_REGION --profile $AWS_PROFILE > /dev/null

echo ""
echo "Deployed. Waiting for service to stabilize..."
/usr/local/aws-cli/aws ecs wait services-stable --cluster $CLUSTER --services $SERVICE \
  --region $AWS_REGION --profile $AWS_PROFILE 2>/dev/null && echo "Backend is live." || echo "Check AWS console for status."
