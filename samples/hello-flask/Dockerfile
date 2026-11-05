FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
# Hostra reads the first EXPOSE to know which port to route to
EXPOSE 5000
# run as a non-root user
RUN useradd --create-home app
USER app
CMD ["python", "app.py"]
