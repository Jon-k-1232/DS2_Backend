FROM public.ecr.aws/lambda/python:3.11

# Install build dependencies and runtime libraries
RUN yum install -y \
    gcc \
    make \
    readline-devel \
    zlib-devel \
    openssl-devel \
    libicu-devel \
    wget \
    tar \
    gzip \
    bison \
    flex \
    perl \
    && yum clean all

# Set library path and PATH for PostgreSQL
ENV LD_LIBRARY_PATH="/usr/local/pgsql/lib"
ENV PATH="/usr/local/pgsql/bin:${PATH}"

# Download and compile PostgreSQL 17 (client only)
RUN cd /tmp && \
    wget -q https://ftp.postgresql.org/pub/source/v17.2/postgresql-17.2.tar.gz && \
    tar xzf postgresql-17.2.tar.gz && \
    cd postgresql-17.2 && \
    ./configure --with-openssl --without-readline --without-zlib --without-icu && \
    cd src/interfaces/libpq && \
    make && \
    make install && \
    cd /tmp/postgresql-17.2/src/bin/pg_dump && \
    make && \
    make install && \
    cp -r /usr/local/pgsql/lib/* /usr/lib64/ && \
    cd /tmp && \
    rm -rf postgresql-17.2* && \
    pg_dump --version

# Copy Lambda function code
COPY lambda_function.py ${LAMBDA_TASK_ROOT}

# Install Python dependencies
RUN pip install --no-cache-dir boto3

# Set the CMD to your handler
CMD [ "lambda_function.handler" ]
