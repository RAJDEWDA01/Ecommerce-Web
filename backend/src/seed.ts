import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from './config/db.js';
import Product from './models/Product.js';


dotenv.config();

const importData = async () => {
  try {
  
    await connectDB();

 
    await Product.deleteMany();


    const sampleProducts = [
      {
        name: 'Gaumaya Farm Desi Gir Cow Ghee',
        description: 'Pure & Natural Desi Gir Cow Ghee. Crafted traditionally to preserve authentic aroma, texture, and nutritional value.',
        price: 650,
        size: '500ml',
        imageUrl: '/images/gaumaya-ghee.jpg',
        imageGallery: [
          '/images/gaumaya-ghee.jpg',
          '/images/gaumaya-ghee-1.jpg',
          '/images/gaumaya-ghee-2.jpg',
          '/images/gaumaya-ghee-3.jpg',
        ],
        variants: [
          {
            label: '200ml',
            size: '200ml',
            price: 320,
            stockQuantity: 60,
            sku: 'GF-GHEE-200',
            imageUrl: '/images/gaumaya-ghee-1.jpg',
            isDefault: false,
          },
          {
            label: '500ml',
            size: '500ml',
            price: 650,
            stockQuantity: 80,
            sku: 'GF-GHEE-500',
            imageUrl: '/images/gaumaya-ghee-2.jpg',
            isDefault: true,
          },
          {
            label: '1kg',
            size: '1kg',
            price: 1250,
            stockQuantity: 40,
            sku: 'GF-GHEE-1KG',
            imageUrl: '/images/gaumaya-ghee-3.jpg',
            isDefault: false,
          },
        ],
        stockQuantity: 180,
        sku: 'GF-GHEE-500',
        isFeatured: true
      }
    ];

    
    await Product.insertMany(sampleProducts);
    
    console.log('Gaumaya Farm Product Imported Successfully!');
    process.exit(); 
  } catch (error) {
    console.error('Error importing data:', error);
    process.exit(1); 
  }
};


importData();
