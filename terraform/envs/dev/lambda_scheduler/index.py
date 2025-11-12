import boto3
import os
import json

ecs = boto3.client('ecs')
asg = boto3.client('autoscaling')

def handler(event, context):
    asg_name = os.environ['ASG_NAME']
    cluster = os.environ['ECS_CLUSTER']
    service = os.environ['ECS_SERVICE']
    desired = int(os.environ['DESIRED_CAPACITY'])
    
    try:
        # Update ECS service desired count
        print(f"Setting ECS service {service} desired count to {desired}")
        ecs.update_service(
            cluster=cluster,
            service=service,
            desiredCount=desired
        )
        
        # Update ASG desired capacity
        print(f"Setting ASG {asg_name} desired capacity to {desired}")
        asg.set_desired_capacity(
            AutoScalingGroupName=asg_name,
            DesiredCapacity=desired
        )
        
        action = "scaled down" if desired == 0 else "scaled up"
        return {
            'statusCode': 200,
            'body': json.dumps(f'Successfully {action} infrastructure')
        }
        
    except Exception as e:
        print(f"Error: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps(f'Error: {str(e)}')
        }
