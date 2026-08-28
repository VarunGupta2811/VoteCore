from db import get_connection


try:
    connection = get_connection()

    print("Oracle connection successful!")

    cursor = connection.cursor()

    cursor.execute("SELECT USER FROM DUAL")

    result = cursor.fetchone()

    print("Connected user:", result[0])

    cursor.close()
    connection.close()

except Exception as e:
    print("Oracle connection failed:")
    print(e)