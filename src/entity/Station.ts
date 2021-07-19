import {
    Entity,
    Column,
    PrimaryGeneratedColumn,
    CreateDateColumn,
} from 'typeorm';

@Entity({ name: 'station' })
export default class Station {
    @PrimaryGeneratedColumn()
    id!: number;

    @Column({ length: 63 })
    name!: string;

    @Column({ length: 15 })
    line!: string;

    @Column({ type: 'float' })
    lat!: number;

    @Column({ type: 'float' })
    lng!: number;

    @CreateDateColumn({ name: 'created_at' })
    createdAt!: Date;
}
