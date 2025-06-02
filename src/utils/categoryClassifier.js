// utils/categoryClassifier.js

const categoryMap = [
  { keywords: ['uber', 'ola', 'taxi'], category: 'Transport', subCategory: 'Taxi' },
  { keywords: ['starbucks', 'cafe', 'coffee'], category: 'Food', subCategory: 'Cafe' },
  { keywords: ['flipkart', 'amazon', 'myntra'], category: 'Shopping', subCategory: 'E-commerce' },
  { keywords: ['zomato', 'swiggy', 'restaurant'], category: 'Food', subCategory: 'Dining' },
  { keywords: ['rent', 'landlord'], category: 'Housing', subCategory: 'Rent' },
  { keywords: ['salary', 'payroll', 'credited'], category: 'Income', subCategory: null },
  // add more rules here
];

export function classifyCategory(text) {
  text = text.toLowerCase();
  for (const rule of categoryMap) {
    for (const kw of rule.keywords) {
      if (text.includes(kw)) {
        return { category: rule.category, subCategory: rule.subCategory };
      }
    }
  }
  return { category: 'General Expense', subCategory: null };
}
