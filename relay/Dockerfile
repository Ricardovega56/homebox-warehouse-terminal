FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    cups-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

RUN mkdir -p /data

COPY *.py ./

EXPOSE 5000
CMD ["uvicorn", "relay:app", "--host", "0.0.0.0", "--port", "5000"]
