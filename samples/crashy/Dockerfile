FROM python:3.12-slim
WORKDIR /app
COPY app.py .
# No EXPOSE on purpose: Hostra falls back to port 8000 (the app reads $PORT).
CMD ["python", "-u", "app.py"]
