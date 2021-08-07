import {
    BadRequestException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { Repository, Connection } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { uuid } from 'uuidv4';
import { CreateMeetingPlaceDto } from './dto/create-meeting-place.dto';
import { CreateMeetingDto } from './dto/create-meeting.dto';
import { UpdateMeetingDto } from './dto/update-meeting.dto';
import MeetingPlaces from '../entities/MeetingPlaces';
import MeetingMembers from '../entities/MeetingMembers';
import Meetings from '../entities/Meetings';
import MeetingSchedules from '../entities/MeetingSchedules';
import Users from '../entities/Users';
import UsersToMeetings from '../entities/UsersToMeetings';
import Stations from '../entities/Stations';
import * as geolib from 'geolib';

export interface Point {
    latitude: number;
    longitude: number;
}

@Injectable()
export class MeetingsService {
    constructor(
        private connection: Connection,
        @InjectRepository(MeetingPlaces)
        private meetingPlacesRepository: Repository<MeetingPlaces>,
        @InjectRepository(MeetingMembers)
        private meetingMembersRepository: Repository<MeetingMembers>,
        @InjectRepository(Meetings)
        private meetingsRepository: Repository<Meetings>,
        @InjectRepository(MeetingSchedules)
        private meetingSchedulesRepository: Repository<MeetingSchedules>,
        @InjectRepository(UsersToMeetings)
        private usersToMeetingsRepository: Repository<UsersToMeetings>,
        @InjectRepository(Stations)
        private stationsRepository: Repository<Stations>
    ) {}

    async create(userId: number, data: CreateMeetingDto) {
        let checkOverlap: number;
        let param = uuid();

        while (true) {
            checkOverlap = await this.meetingsRepository
                .createQueryBuilder()
                .select()
                .where('param=:param', { param: param })
                .getCount();

            if (checkOverlap == 0) break;

            param = uuid();
        }

        const queryRunner = this.connection.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const meetings = new Meetings();
            meetings.title = data.title;
            meetings.description = data.description;
            meetings.placeYn = data.placeYn;
            meetings.param = param;

            const createMeeting = await this.meetingsRepository.save(meetings);

            const meetingMembers = new MeetingMembers();
            meetingMembers.nickname = data.nickname;
            meetingMembers.auth = true;

            const meetingSchedules = new MeetingSchedules();
            meetingSchedules.startDate = new Date(data.startDate);
            meetingSchedules.endDate = new Date(data.endDate);

            if (userId) {
                const users = new Users();
                const usersToMeetings = new UsersToMeetings();
                users.id = userId;
                meetingMembers.user = users;
                usersToMeetings.user = users;
                usersToMeetings.meetings = createMeeting;
                await this.usersToMeetingsRepository.save(usersToMeetings);
            }

            meetingMembers.meetings = createMeeting;
            meetingSchedules.meetings = createMeeting;

            await this.meetingMembersRepository.save(meetingMembers);
            await this.meetingSchedulesRepository.save(meetingSchedules);

            if (createMeeting) {
                return {
                    result: true,
                    code: 200,
                    data: {
                        meetingInfo: createMeeting,
                        message: '모임을 생성했습니다. ',
                    },
                };
            }
        } catch (err) {
            throw new BadRequestException({
                message: '모임생성 중 오류가 발생했습니다.',
            });
        } finally {
            await queryRunner.release();
        }
    }

    async getMembers(meetingId: number): Promise<MeetingMembers[] | undefined> {
        try {
            const meeting = await this.meetingsRepository
                .createQueryBuilder('meetings')
                .where('meetings.id =:meetingId', { meetingId })
                .leftJoin('meetings.meetingMembers', 'member')
                .addSelect(['member.id', 'member.nickname', 'member.auth'])
                .getOne();
            if (!meeting) return undefined;
            return meeting.meetingMembers;
        } catch (err) {
            throw err;
        }
    }

    async checkOverlapNickname(meetingId: number, nickname: string) {
        const checkOverlap = await this.meetingMembersRepository
            .createQueryBuilder()
            .where('nickname=:nickname', { nickname: nickname })
            .andWhere('meeting_id=:meetingId', { meetingId: meetingId })
            .getCount();

        return {
            result: true,
            code: 200,
            data: {
                checkOverlap: checkOverlap,
            },
        };
    }

    async createPlace({
        memberId,
        latitude,
        longitude,
    }: CreateMeetingPlaceDto): Promise<number | undefined> {
        const meetingMember = await this.meetingMembersRepository.findOne(
            memberId
        );
        if (!meetingMember) return undefined;
        const result = await this.meetingPlacesRepository
            .createQueryBuilder()
            .insert()
            .into(MeetingPlaces)
            .values({ latitude, longitude, meetingMember })
            .execute();
        return result.raw.insertId;
    }

    async findMeetingsList(userId: number) {
        const list = await this.meetingsRepository
            .createQueryBuilder('meetings')
            .innerJoinAndSelect('meetings.userToMeetings', 'userToMeetings')
            .innerJoinAndSelect('userToMeetings.user', 'user')
            .innerJoinAndSelect('meetings.meetingMembers', 'meetingMembers')
            .where('user.id = :userId', { userId: userId })
            .select([
                'meetings.id as id',
                'meetings.title as title',
                'meetings.param as param',
                'meetings.description as description',
                'meetings.placeYn as place_yn',
                'date_format(userToMeetings.createdAt, "%Y-%m-%d %h:%i:%s") as created_at',
                'meetingMembers.auth as auth',
            ])
            .getRawMany();

        return {
            result: true,
            code: 200,
            data: {
                list: list,
            },
        };
    }

    // 유저 가드붙여서 유저 검증작업이 필요함.
    async update(meetingsId: number, updateMeetingDto: UpdateMeetingDto) {
        const meetings = await this.meetingsRepository.findOne({
            where: { id: meetingsId },
        });

        if (!meetings) {
            throw new UnauthorizedException('미팅정보가 존재하지 않습니다.');
        }

        try {
            await this.meetingsRepository
                .createQueryBuilder('meetings')
                .update(Meetings)
                .set({
                    title: updateMeetingDto.title,
                    description: updateMeetingDto.description,
                })
                .where('id=:meetingsId', { meetingsId: 2 })
                .execute();

            return {
                result: true,
                code: 200,
                data: {
                    message: '모임을 수정했습니다. ',
                },
            };
        } catch (err) {
            throw new BadRequestException({
                message: '모임수정 중 오류가 발생했습니다.',
            });
        }
    }

    async isAuth(user: Users, meetingId: number) {
        try {
            const member = await this.meetingMembersRepository
                .createQueryBuilder()
                .where('id =:meetingId', { meetingId })
                .andWhere('user_id =:userId', { userId: user.id })
                .getOne();
            return member.auth;
        } catch (err) {
            throw err;
        }
    }

    async removeMember(memberId: number) {
        try {
            this.meetingMembersRepository
                .createQueryBuilder()
                .where('id=:memberId', { memberId })
                .delete()
                .execute();
        } catch (err) {
            throw err;
        }
    }

    async getPlace(meetingId: number) {
        const center = await this.getCenter(meetingId);
        if (!center) return {};
        const stations = await this.getStations(center);
        return {
            center,
            stations,
        };
    }

    private async getCenter(meetingId: number): Promise<Point | false> {
        try {
            const points = await this.meetingPlacesRepository
                .createQueryBuilder('MeetingPlaces')
                .leftJoin('MeetingPlaces.meetingMember', 'meetingMember')
                .where('meetingMember.meeting_id =:meetingId', { meetingId })
                .select(['MeetingPlaces.latitude', 'MeetingPlaces.longitude'])
                .getMany();
            return geolib.getCenter(points);
        } catch (err) {
            throw err;
        }
    }

    private async getStations(center: Point) {
        try {
            const stations: Point[] = await this.stationsRepository
                .createQueryBuilder()
                .getMany();
            const distances = geolib.orderByDistance(center, stations);
            return distances.slice(0, 5);
        } catch (err) {
            throw err;
        }
    }
}
