FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TRACKER_DATA_DIR=/data

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && addgroup --system tracker \
    && adduser --system --ingroup tracker --home /app tracker

COPY --chown=tracker:tracker . .
RUN mkdir -p /data && chown tracker:tracker /data

USER tracker
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3)"

CMD ["python", "main.py", "--host", "0.0.0.0", "--port", "8000", "--no-browser"]
