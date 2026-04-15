# API Endpoints

## Auth

POST /api/auth/login  
POST /api/auth/register  

---

## Users

GET /api/users/me  

---

## Orders

POST /api/orders  
GET /api/orders/:id  

---

## Response Format

{
  success: boolean,
  data: any,
  error?: string
}