'use client';
import {useEffect} from 'react';
import {useRouter} from 'next/navigation';
export function StoreSync(){const router=useRouter();useEffect(()=>{function sync(){if(document.visibilityState==='visible')router.refresh();}const timer=setInterval(sync,30000);window.addEventListener('focus',sync);return()=>{clearInterval(timer);window.removeEventListener('focus',sync);};},[router]);return null;}
