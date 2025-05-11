import pandas as pd
import sys

try:
    # Download Iris dataset
    print("Downloading Iris dataset...")
    iris_csv_url = 'https://raw.githubusercontent.com/plotly/datasets/master/iris.csv'
    df = pd.read_csv(iris_csv_url)
    
    # Save as parquet
    print("Converting to parquet format...")
    df.to_parquet('iris.parquet')
    print("Conversion completed: iris.parquet created")
    print(f"Parquet file size: {df.shape[0]} rows, {df.shape[1]} columns")
    print("Sample data:")
    print(df.head())
except Exception as e:
    print(f"Error: {e}", file=sys.stderr)
    sys.exit(1)
