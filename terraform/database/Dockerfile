FROM public.ecr.aws/lambda/python:3.11

# Install PostgreSQL client (pg_dump)
RUN yum install -y postgresql

# Copy handler code
COPY lambda_function.py ./

CMD ["lambda_function.lambda_handler"]
