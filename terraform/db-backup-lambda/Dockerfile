# Stage 1: Get PostgreSQL 17 client from official image
FROM postgres:17-alpine AS postgres

# Stage 2: Lambda runtime
FROM public.ecr.aws/lambda/python:3.11

# Copy pg_dump and dependencies from postgres image
COPY --from=postgres /usr/local/bin/pg_dump /usr/local/bin/pg_dump
COPY --from=postgres /usr/local/lib/libpq.so.5 /usr/local/lib/libpq.so.5
COPY --from=postgres /usr/local/lib/postgresql/ /usr/local/lib/postgresql/

# Install gzip and required libraries
RUN yum install -y gzip && \
    ln -s /usr/local/lib/libpq.so.5 /usr/lib64/libpq.so.5

# Install boto3
RUN pip install boto3

# Copy handler code
COPY lambda_function.py ./

CMD ["lambda_function.lambda_handler"]
